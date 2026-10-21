import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { CharacterEvolution, PlayerCharacter, UserStore } from '../types/accounts';
import { statsForEvolution, type CharacterStats, type ClientPvPMessage, type DuelView, type NetworkPlayer, type ServerPvPMessage } from '../types/pvp';

const CHALLENGE_TIMEOUT_MS = 60_000;
const DUEL_DURATION_MS = 5 * 60_000;
const BASIC_ATTACK_COOLDOWN_MS = 1_000;
const SKILL_TWO_COOLDOWN_MS = 8_000;
const SKILL_TWO_MULTIPLIER = 1.5;
const DEFEAT_RESOLUTION_DELAY_MS = 100;

interface PlayerSession {
  socket: WebSocket;
  character: PlayerCharacter;
  username: string;
  x: number;
  y: number;
  direction: number;
  challengeId?: string;
  duelId?: string;
  lastBasicAttackAt: number;
  lastSkillTwoAt: number;
}

interface Challenge {
  id: string;
  fromId: string;
  toId: string;
  expiresAt: number;
  timeout: ReturnType<typeof setTimeout>;
}

interface Duel {
  id: string;
  playerIds: [string, string];
  hp: Map<string, number>;
  maxHp: Map<string, number>;
  stats: Map<string, CharacterStats>;
  endsAt: number;
  timeout: ReturnType<typeof setTimeout>;
  defeatResolution?: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvolution(value: unknown): value is CharacterEvolution {
  return value === 'snake' || value === 'red-snake' || value === 'dragon';
}

function send(socket: WebSocket, message: ServerPvPMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function parseMessage(data: WebSocket.RawData): ClientPvPMessage | undefined {
  try {
    const value: unknown = JSON.parse(data.toString());
    if (!isRecord(value) || typeof value.type !== 'string') return undefined;
    switch (value.type) {
      case 'join':
        if (
          typeof value.username === 'string' &&
          typeof value.characterId === 'string' &&
          typeof value.x === 'number' &&
          Number.isFinite(value.x) &&
          typeof value.y === 'number' &&
          Number.isFinite(value.y) &&
          typeof value.direction === 'number' &&
          Number.isInteger(value.direction) &&
          value.direction >= 0 &&
          value.direction < 8
        ) {
          return {
            type: 'join',
            username: value.username,
            characterId: value.characterId,
            x: value.x,
            y: value.y,
            direction: value.direction
          };
        }
        return undefined;
      case 'position':
        if (
          typeof value.x === 'number' &&
          Number.isFinite(value.x) &&
          typeof value.y === 'number' &&
          Number.isFinite(value.y) &&
          typeof value.direction === 'number' &&
          Number.isInteger(value.direction) &&
          value.direction >= 0 &&
          value.direction < 8
        ) {
          return { type: 'position', x: value.x, y: value.y, direction: value.direction };
        }
        return undefined;
      case 'character-update':
        return isEvolution(value.evolution)
          ? { type: 'character-update', evolution: value.evolution }
          : undefined;
      case 'challenge':
        return typeof value.targetId === 'string' ? { type: 'challenge', targetId: value.targetId } : undefined;
      case 'challenge-response':
        return typeof value.challengeId === 'string' && typeof value.accept === 'boolean'
          ? { type: 'challenge-response', challengeId: value.challengeId, accept: value.accept }
          : undefined;
      case 'challenge-cancel':
        return typeof value.challengeId === 'string'
          ? { type: 'challenge-cancel', challengeId: value.challengeId }
          : undefined;
      case 'attack':
        return typeof value.targetId === 'string' &&
          (value.action === 'basic-attack' || value.action === 'skill-2')
          ? { type: 'attack', targetId: value.targetId, action: value.action }
          : undefined;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function characterStats(character: PlayerCharacter): CharacterStats {
  return character.stats ?? statsForEvolution(character.evolution);
}

function viewFor(
  viewerId: string,
  session: PlayerSession,
  sessions: Map<string, PlayerSession>,
  duels: Map<string, Duel>
): NetworkPlayer {
  const stats = characterStats(session.character);
  const viewer = sessions.get(viewerId);
  const duel = session.duelId && session.duelId === viewer?.duelId ? duels.get(session.duelId) : undefined;
  return {
    id: session.character.id,
    username: session.username,
    name: session.character.name,
    gender: session.character.gender,
    evolution: session.character.evolution,
    x: session.x,
    y: session.y,
    direction: session.direction,
    hp: duel?.hp.get(session.character.id) ?? stats.maxHp,
    maxHp: stats.maxHp,
    pk: !!session.duelId && session.duelId === sessions.get(viewerId)?.duelId
  };
}

function duelView(playerId: string, duel: Duel, sessions: Map<string, PlayerSession>): DuelView {
  const opponentId = duel.playerIds.find((id) => id !== playerId)!;
  const opponent = sessions.get(opponentId)!;
  return {
    id: duel.id,
    opponentId,
    opponentName: opponent.character.name,
    yourHp: duel.hp.get(playerId)!,
    yourMaxHp: duel.maxHp.get(playerId)!,
    opponentHp: duel.hp.get(opponentId)!,
    opponentMaxHp: duel.maxHp.get(opponentId)!,
    endsAt: duel.endsAt
  };
}

export function attachPvpServer(httpServer: Server, readUsers: () => UserStore): (characterId: string) => boolean {
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 8192 });
  const sessions = new Map<string, PlayerSession>();
  const challenges = new Map<string, Challenge>();
  const duels = new Map<string, Duel>();
  const emitPresence = (): void => {
    for (const [viewerId, viewer] of sessions) {
      const players = [...sessions.entries()]
        .filter(([id]) => id !== viewerId)
        .map(([, session]) => viewFor(viewerId, session, sessions, duels));
      send(viewer.socket, { type: 'players', players });
    }
  };

  const notifyChallengeCancelled = (challenge: Challenge, message: string): void => {
    clearTimeout(challenge.timeout);
    challenges.delete(challenge.id);
    const challenger = sessions.get(challenge.fromId);
    const target = sessions.get(challenge.toId);
    if (challenger?.challengeId === challenge.id) challenger.challengeId = undefined;
    if (target?.challengeId === challenge.id) target.challengeId = undefined;
    if (challenger) send(challenger.socket, { type: 'challenge-cancelled', challengeId: challenge.id, message });
    if (target) send(target.socket, { type: 'challenge-cancelled', challengeId: challenge.id, message });
  };

  const endDuel = (
    duel: Duel,
    winnerId: string | null,
    reason: 'defeat' | 'timeout' | 'disconnect',
    message: string
  ): void => {
    if (!duels.has(duel.id)) return;
    clearTimeout(duel.timeout);
    if (duel.defeatResolution) clearTimeout(duel.defeatResolution);
    duels.delete(duel.id);
    for (const playerId of duel.playerIds) {
      const session = sessions.get(playerId);
      if (session?.duelId === duel.id) session.duelId = undefined;
      if (session) send(session.socket, { type: 'duel-end', duelId: duel.id, winnerId, reason, message });
    }
    emitPresence();
  };

  const startDuel = (from: PlayerSession, to: PlayerSession): void => {
    const id = randomUUID();
    const endsAt = Date.now() + DUEL_DURATION_MS;
    const fromStats = characterStats(from.character);
    const toStats = characterStats(to.character);
    const duel: Duel = {
      id,
      playerIds: [from.character.id, to.character.id],
      hp: new Map([[from.character.id, fromStats.maxHp], [to.character.id, toStats.maxHp]]),
      maxHp: new Map([[from.character.id, fromStats.maxHp], [to.character.id, toStats.maxHp]]),
      stats: new Map([[from.character.id, fromStats], [to.character.id, toStats]]),
      endsAt,
      timeout: setTimeout(() => {
        endDuel(duel, null, 'timeout', 'Hết 5 phút, tỷ thí hòa.');
      }, DUEL_DURATION_MS)
    };
    from.duelId = id;
    to.duelId = id;
    from.lastBasicAttackAt = 0;
    to.lastBasicAttackAt = 0;
    from.lastSkillTwoAt = 0;
    to.lastSkillTwoAt = 0;
    duels.set(id, duel);
    send(from.socket, { type: 'duel-start', duel: duelView(from.character.id, duel, sessions) });
    send(to.socket, { type: 'duel-start', duel: duelView(to.character.id, duel, sessions) });
    emitPresence();
  };

  const removeSession = (session: PlayerSession): void => {
    const playerId = session.character.id;
    if (sessions.get(playerId) !== session) return;

    if (session.challengeId) {
      const challenge = challenges.get(session.challengeId);
      if (challenge) notifyChallengeCancelled(challenge, 'Lời mời tỷ thí đã bị hủy vì người chơi ngắt kết nối.');
    }
    for (const challenge of challenges.values()) {
      if (challenge.toId === playerId || challenge.fromId === playerId) {
        notifyChallengeCancelled(challenge, 'Lời mời tỷ thí đã bị hủy vì người chơi ngắt kết nối.');
      }
    }
    if (session.duelId) {
      const duel = duels.get(session.duelId);
      if (duel) {
        const winnerId = duel.playerIds.find((id) => id !== playerId) ?? null;
        endDuel(duel, winnerId, 'disconnect', 'Đối thủ đã ngắt kết nối; bạn thắng tỷ thí.');
      }
    }
    sessions.delete(playerId);
    emitPresence();
  };

  const handleJoin = (socket: WebSocket, message: Extract<ClientPvPMessage, { type: 'join' }>): PlayerSession | undefined => {
    let store: UserStore;
    try {
      store = readUsers();
    } catch (error) {
      console.error('[PvP] Không thể đọc users.json khi đăng nhập WebSocket.', error);
      send(socket, { type: 'error', message: 'Không thể tải dữ liệu người chơi.' });
      socket.close(1011, 'User store unavailable');
      return undefined;
    }
    const user = store.users.find((entry) => entry.username.toLowerCase() === message.username.trim().toLowerCase());
    const character = user?.characters.find((entry) => entry.id === message.characterId);
    if (!user || !character) {
      send(socket, { type: 'error', message: 'Không tìm thấy tài khoản hoặc nhân vật đã chọn.' });
      socket.close(1008, 'Unknown character');
      return undefined;
    }
    if (sessions.has(character.id)) {
      send(socket, { type: 'error', message: 'Nhân vật này đang được sử dụng ở trình duyệt khác.' });
      socket.close(1008, 'Character already online');
      return undefined;
    }

    const usedTiles = new Set([...sessions.values()].map((entry) => `${Math.floor(entry.x)},${Math.floor(entry.y)}`));
    const candidates = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]
    ] as const;
    let x = message.x;
    let y = message.y;
    for (const [dx, dy] of candidates) {
      const nextX = Math.max(0.01, message.x + dx);
      const nextY = Math.max(0.01, message.y + dy);
      if (!usedTiles.has(`${Math.floor(nextX)},${Math.floor(nextY)}`)) {
        x = nextX;
        y = nextY;
        break;
      }
    }
    const session: PlayerSession = {
      socket,
      character,
      username: user.username,
      x,
      y,
      direction: message.direction,
      lastBasicAttackAt: 0,
      lastSkillTwoAt: 0
    };
    sessions.set(character.id, session);
    const player = viewFor(character.id, session, sessions, duels);
    const players = [...sessions.entries()]
      .filter(([id]) => id !== character.id)
      .map(([, other]) => viewFor(character.id, other, sessions, duels));
    send(socket, { type: 'joined', player, players, stats: characterStats(character) });
    emitPresence();
    return session;
  };

  const handleMessage = (session: PlayerSession, message: ClientPvPMessage): void => {
    switch (message.type) {
      case 'join':
        send(session.socket, { type: 'error', message: 'WebSocket đã được đăng nhập.' });
        break;
      case 'position':
        if (Math.abs(message.x) > 10000 || Math.abs(message.y) > 10000) {
          send(session.socket, { type: 'error', message: 'Tọa độ nhân vật không hợp lệ.' });
          break;
        }
        session.x = message.x;
        session.y = message.y;
        session.direction = message.direction;
        emitPresence();
        break;
      case 'character-update': {
        if (session.duelId) {
          send(session.socket, { type: 'error', message: 'Không thể tiến hóa khi đang tỷ thí.' });
          break;
        }
        let updatedCharacter: PlayerCharacter | undefined;
        try {
          const user = readUsers().users.find(
            (entry) => entry.username.toLowerCase() === session.username.toLowerCase()
          );
          updatedCharacter = user?.characters.find((entry) => entry.id === session.character.id);
        } catch (error) {
          console.error('[PvP] Không thể đọc dữ liệu tiến hóa.', error);
        }
        if (!updatedCharacter || updatedCharacter.evolution !== message.evolution) {
          send(session.socket, { type: 'error', message: 'Tiến hóa nhân vật không khớp với dữ liệu đã lưu.' });
          break;
        }
        session.character = updatedCharacter;
        send(session.socket, { type: 'player-updated', stats: characterStats(updatedCharacter) });
        emitPresence();
        break;
      }
      case 'challenge': {
        const target = sessions.get(message.targetId);
        if (!target || target === session) {
          send(session.socket, { type: 'error', message: 'Người chơi này hiện không online.' });
          break;
        }
        if (target.username.toLowerCase() === session.username.toLowerCase()) {
          send(session.socket, { type: 'error', message: 'Tỷ thí yêu cầu hai tài khoản khác nhau.' });
          break;
        }
        if (session.duelId || target.duelId) {
          send(session.socket, { type: 'error', message: 'Một trong hai người đang tỷ thí.' });
          break;
        }
        if (session.challengeId || target.challengeId) {
          send(session.socket, { type: 'error', message: 'Một trong hai người đang có lời mời tỷ thí khác.' });
          break;
        }
        const challenge: Challenge = {
          id: randomUUID(),
          fromId: session.character.id,
          toId: target.character.id,
          expiresAt: Date.now() + CHALLENGE_TIMEOUT_MS,
          timeout: setTimeout(() => {
            notifyChallengeCancelled(challenge, 'Lời mời tỷ thí đã hết hạn.');
          }, CHALLENGE_TIMEOUT_MS)
        };
        challenges.set(challenge.id, challenge);
        session.challengeId = challenge.id;
        target.challengeId = challenge.id;
        send(session.socket, {
          type: 'challenge-outgoing',
          challengeId: challenge.id,
          target: { id: target.character.id, username: target.username, name: target.character.name },
          expiresAt: challenge.expiresAt
        });
        send(target.socket, {
          type: 'challenge-incoming',
          challengeId: challenge.id,
          challenger: {
            id: session.character.id,
            username: session.username,
            name: session.character.name,
            evolution: session.character.evolution
          },
          expiresAt: challenge.expiresAt
        });
        break;
      }
      case 'challenge-response': {
        const challenge = challenges.get(message.challengeId);
        if (!challenge || challenge.toId !== session.character.id) {
          send(session.socket, { type: 'error', message: 'Lời mời tỷ thí không còn hiệu lực.' });
          break;
        }
        if (challenge.expiresAt <= Date.now()) {
          notifyChallengeCancelled(challenge, 'Lời mời tỷ thí đã hết hạn.');
          break;
        }
        const challenger = sessions.get(challenge.fromId);
        notifyChallengeCancelled(challenge, message.accept ? 'Lời mời đã được xác nhận.' : 'Lời mời đã bị từ chối.');
        if (message.accept && challenger && sessions.get(session.character.id) === session) {
          startDuel(challenger, session);
        }
        break;
      }
      case 'challenge-cancel': {
        const challenge = challenges.get(message.challengeId);
        if (challenge?.fromId === session.character.id) {
          notifyChallengeCancelled(challenge, 'Người thách đấu đã hủy lời mời.');
        }
        break;
      }
      case 'attack': {
        const duel = session.duelId ? duels.get(session.duelId) : undefined;
        const opponentId = duel?.playerIds.find((id) => id !== session.character.id);
        if (!duel || message.targetId !== opponentId || !opponentId) {
          send(session.socket, { type: 'error', message: 'Chỉ có thể đánh đối thủ đang tỷ thí với bạn.' });
          break;
        }
        const now = Date.now();
        if (now >= duel.endsAt) {
          endDuel(duel, null, 'timeout', 'Hết 5 phút, tỷ thí hòa.');
          break;
        }
        const lastAttackAt = message.action === 'basic-attack' ? session.lastBasicAttackAt : session.lastSkillTwoAt;
        const cooldown = message.action === 'basic-attack' ? BASIC_ATTACK_COOLDOWN_MS : SKILL_TWO_COOLDOWN_MS;
        if (now - lastAttackAt < cooldown) {
          const remaining = Math.ceil((cooldown - (now - lastAttackAt)) / 1000);
          send(session.socket, { type: 'error', message: `Kỹ năng đang hồi chiêu (${remaining}s).` });
          break;
        }
        if (message.action === 'basic-attack') session.lastBasicAttackAt = now;
        else session.lastSkillTwoAt = now;
        const attackerStats = duel.stats.get(session.character.id)!;
        const defenderStats = duel.stats.get(opponentId)!;
        const multiplier = message.action === 'basic-attack' ? 1 : SKILL_TWO_MULTIPLIER;
        const damage = Math.max(
          1,
          Math.floor(attackerStats.attack * multiplier - Math.max(0, defenderStats.defense - attackerStats.armorPen))
        );
        const remainingHp = Math.max(0, duel.hp.get(opponentId)! - damage);
        duel.hp.set(opponentId, remainingHp);
        for (const playerId of duel.playerIds) {
          const recipient = sessions.get(playerId);
          if (recipient) {
            send(recipient.socket, {
              type: 'duel-update',
              duel: duelView(playerId, duel, sessions),
              actorId: session.character.id,
              action: message.action,
              damage
            });
          }
        }
        emitPresence();
        if (duel.playerIds.every((id) => duel.hp.get(id)! <= 0)) {
          endDuel(duel, null, 'defeat', 'Cả hai nhân vật đều hết máu; tỷ thí hòa.');
        } else if (remainingHp <= 0 && !duel.defeatResolution) {
          duel.defeatResolution = setTimeout(() => {
            duel.defeatResolution = undefined;
            if (!duels.has(duel.id)) return;
            const standingPlayers = duel.playerIds.filter((id) => duel.hp.get(id)! > 0);
            if (standingPlayers.length === 0) {
              endDuel(duel, null, 'defeat', 'Cả hai nhân vật đều hết máu; tỷ thí hòa.');
            } else if (standingPlayers.length === 1) {
              endDuel(duel, standingPlayers[0], 'defeat', 'Một nhân vật đã hết máu; tỷ thí kết thúc.');
            }
          }, DEFEAT_RESOLUTION_DELAY_MS);
        }
        break;
      }
    }
  };

  const onUpgrade = (request: IncomingMessage, socket: import('node:net').Socket, head: Buffer): void => {
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/ws') return;
    const origin = request.headers.origin;
    if (origin) {
      const rejectUpgrade = (): void => {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
      };
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        rejectUpgrade();
        return;
      }
      if (originHost !== request.headers.host) {
        rejectUpgrade();
        return;
      }
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      let session: PlayerSession | undefined;
      let joined = false;
      const joinTimeout = setTimeout(() => webSocket.close(1008, 'Join timeout'), 10_000);
      webSocket.on('message', (data) => {
        const message = parseMessage(data);
        if (!message) {
          send(webSocket, { type: 'error', message: 'Thông điệp không hợp lệ.' });
          return;
        }
        if (!joined) {
          if (message.type !== 'join') {
            send(webSocket, { type: 'error', message: 'Cần đăng nhập trước.' });
            webSocket.close(1008, 'Join required');
            return;
          }
          session = handleJoin(webSocket, message);
          joined = !!session;
          if (joined) clearTimeout(joinTimeout);
          return;
        }
        if (message.type === 'join') {
          send(webSocket, { type: 'error', message: 'WebSocket đã được đăng nhập.' });
          return;
        }
        if (session) handleMessage(session, message);
      });
      webSocket.on('close', () => {
        clearTimeout(joinTimeout);
        if (session) removeSession(session);
      });
      webSocket.on('error', (error) => console.error('[PvP WebSocket]', error));
    });
  };

  httpServer.on('upgrade', onUpgrade);
  httpServer.once('close', () => {
    httpServer.off('upgrade', onUpgrade);
    for (const challenge of challenges.values()) clearTimeout(challenge.timeout);
    for (const duel of duels.values()) clearTimeout(duel.timeout);
    for (const session of sessions.values()) session.socket.close(1001, 'Server shutting down');
    challenges.clear();
    duels.clear();
    sessions.clear();
    webSocketServer.close();
  });
  return (characterId) => !!sessions.get(characterId)?.duelId;
}
