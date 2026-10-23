import type { CharacterEvolution, CharacterGender } from './accounts';

export interface CharacterStats {
  maxHp: number;
  attack: number;
  defense: number;
  armorPen: number;
}

export const EVOLUTION_STATS: Record<CharacterEvolution, CharacterStats> = {
  snake: { maxHp: 1000, attack: 100, defense: 20, armorPen: 0 },
  'red-snake': { maxHp: 1400, attack: 135, defense: 35, armorPen: 10 },
  dragon: { maxHp: 1800, attack: 180, defense: 55, armorPen: 20 }
};

export function statsForEvolution(evolution: CharacterEvolution): CharacterStats {
  return { ...EVOLUTION_STATS[evolution] };
}

export interface NetworkPlayer {
  id: string;
  username: string;
  name: string;
  gender: CharacterGender;
  evolution: CharacterEvolution;
  x: number;
  y: number;
  direction: number;
  hp: number;
  maxHp: number;
  pk: boolean;
}

export interface DuelView {
  id: string;
  opponentId: string;
  opponentName: string;
  yourHp: number;
  yourMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  endsAt: number;
}

export interface ChatMessage {
  sequence: number;
  channel: 'current' | 'system' | 'guild';
  characterId?: string;
  username: string;
  characterName: string;
  text: string;
  timestamp: string;
}

export type ClientPvPMessage =
  | { type: 'join'; username: string; characterId: string; x: number; y: number; direction: number }
  | { type: 'position'; x: number; y: number; direction: number }
  | { type: 'character-update'; evolution: CharacterEvolution }
  | { type: 'chat-send'; channel: 'current' | 'guild'; text: string }
  | { type: 'challenge'; targetId: string }
  | { type: 'challenge-response'; challengeId: string; accept: boolean }
  | { type: 'challenge-cancel'; challengeId: string }
  | { type: 'attack'; targetId: string; action: 'basic-attack' | 'skill-2' };

export type ServerPvPMessage =
  | { type: 'joined'; player: NetworkPlayer; players: NetworkPlayer[]; stats: CharacterStats }
  | { type: 'players'; players: NetworkPlayer[] }
  | { type: 'player-updated'; stats: CharacterStats }
  | { type: 'chat-message'; message: ChatMessage }
  | { type: 'chat-error'; message: string }
  | {
      type: 'challenge-incoming';
      challengeId: string;
      challenger: Pick<NetworkPlayer, 'id' | 'username' | 'name' | 'evolution'>;
      expiresAt: number;
    }
  | {
      type: 'challenge-outgoing';
      challengeId: string;
      target: Pick<NetworkPlayer, 'id' | 'username' | 'name'>;
      expiresAt: number;
    }
  | { type: 'challenge-cancelled'; challengeId: string; message: string }
  | { type: 'duel-start'; duel: DuelView }
  | { type: 'duel-update'; duel: DuelView; actorId: string; action: 'basic-attack' | 'skill-2'; damage: number }
  | {
      type: 'duel-end';
      duelId: string;
      winnerId: string | null;
      reason: 'defeat' | 'timeout' | 'disconnect';
      message: string;
    }
  | { type: 'error'; message: string };
