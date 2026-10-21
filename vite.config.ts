import { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { NEXT_CHARACTER_EVOLUTION } from './src/types/accounts';
import { statsForEvolution } from './src/types/pvp';
import { attachPvpServer } from './src/server/pvp';

import type {
  CharacterGender,
  CharacterEvolution,
  CharacterSpecies,
  PlayerCharacter,
  UserAccount,
  UserStore
} from './src/types/accounts';
import type { CharacterStats } from './src/types/pvp';

const genders = ['male', 'female'] as const satisfies readonly CharacterGender[];
const species = ['snake'] as const satisfies readonly CharacterSpecies[];
const evolutions = ['snake', 'red-snake', 'dragon'] as const satisfies readonly CharacterEvolution[];
const usersFile = resolve(process.cwd(), 'users.json');
let isCharacterDueling = (_characterId: string): boolean => false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

interface StoredCharacterStats {
  maxHp: number;
  attack: number;
  defense: number;
  armorPen?: number;
  armorPenetration?: number;
}

function isStoredCharacterStats(value: unknown): value is StoredCharacterStats {
  if (isCharacterStats(value)) return true;
  return (
    isRecord(value) &&
    typeof value.maxHp === 'number' &&
    Number.isFinite(value.maxHp) &&
    value.maxHp > 0 &&
    typeof value.attack === 'number' &&
    Number.isFinite(value.attack) &&
    value.attack > 0 &&
    typeof value.defense === 'number' &&
    Number.isFinite(value.defense) &&
    value.defense >= 0 &&
    !('armorPen' in value) &&
    typeof value.armorPenetration === 'number' &&
    Number.isFinite(value.armorPenetration) &&
    value.armorPenetration >= 0
  );
}

function isStoredCharacter(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isOneOf(value.gender, genders)
  ) {
    return false;
  }
  if ('baseSpecies' in value || 'evolution' in value) {
    return isOneOf(value.baseSpecies, species) &&
      isOneOf(value.evolution, evolutions) &&
      (!('stats' in value) || isStoredCharacterStats(value.stats));
  }
  return isOneOf(value.species, ['snake', 'dragon'] as const);
}

function isCharacterStats(value: unknown): value is CharacterStats {
  return (
    isRecord(value) &&
    typeof value.maxHp === 'number' &&
    Number.isFinite(value.maxHp) &&
    value.maxHp > 0 &&
    typeof value.attack === 'number' &&
    Number.isFinite(value.attack) &&
    value.attack > 0 &&
    typeof value.defense === 'number' &&
    Number.isFinite(value.defense) &&
    value.defense >= 0 &&
    typeof value.armorPen === 'number' &&
    Number.isFinite(value.armorPen) &&
    value.armorPen >= 0
  );
}

function normalizeCharacter(value: unknown): PlayerCharacter {
  if (!isRecord(value) || !isStoredCharacter(value)) {
    throw new Error('Dữ liệu nhân vật trong users.json không hợp lệ.');
  }
  if ('baseSpecies' in value && 'evolution' in value) {
    return {
      id: value.id as string,
      name: value.name as string,
      gender: value.gender as CharacterGender,
      baseSpecies: value.baseSpecies as CharacterSpecies,
      evolution: value.evolution as CharacterEvolution,
      stats: isStoredCharacterStats(value.stats)
        ? {
            maxHp: value.stats.maxHp,
            attack: value.stats.attack,
            defense: value.stats.defense,
            armorPen: value.stats.armorPen ?? value.stats.armorPenetration ?? 0
          }
        : statsForEvolution(value.evolution as CharacterEvolution)
    };
  }
  const oldSpecies = value.species;
  return {
    id: value.id as string,
    name: value.name as string,
    gender: value.gender as CharacterGender,
    baseSpecies: 'snake',
    evolution: oldSpecies === 'dragon' ? 'dragon' : 'snake',
    stats: statsForEvolution(oldSpecies === 'dragon' ? 'dragon' : 'snake')
  };
}

function isUserAccount(value: unknown): value is UserAccount {
  return (
    isRecord(value) &&
    typeof value.username === 'string' &&
    Array.isArray(value.characters) &&
    value.characters.length <= 3 &&
    value.characters.every(isStoredCharacter)
  );
}

function readUsers(): UserStore {
  if (!existsSync(usersFile)) writeFileSync(usersFile, JSON.stringify({ users: [] }, null, 2));
  const store: unknown = JSON.parse(readFileSync(usersFile, 'utf8'));
  if (
    !isRecord(store) ||
    !Array.isArray(store.users) ||
    !store.users.every(isUserAccount)
  ) {
    throw new Error('users.json không đúng định dạng.');
  }
  return {
    users: store.users.map((user) => ({
      username: user.username,
      characters: user.characters.map(normalizeCharacter)
    }))
  };
}

function writeUsers(store: UserStore): void {
  const temporaryFile = `${usersFile}.tmp`;
  writeFileSync(temporaryFile, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(temporaryFile, usersFile);
}

function sendJson(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}

function readBody(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let content = '';
    request.on('data', (chunk: Buffer) => {
      content += chunk.toString();
      if (content.length > 8192) reject(new Error('Nội dung yêu cầu quá lớn.'));
    });
    request.on('error', reject);
    request.on('end', () => {
      try {
        const body: unknown = JSON.parse(content);
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          reject(new Error('Nội dung yêu cầu không hợp lệ.'));
          return;
        }
        resolveBody(body as Record<string, unknown>);
      } catch {
        reject(new Error('JSON không hợp lệ.'));
      }
    });
  });
}

function usersJsonApi(): Plugin {
  return {
    name: 'users-json-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith('/api/')) {
          next();
          return;
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Phương thức không được hỗ trợ.' });
          return;
        }

        try {
          const body = await readBody(request);
          const username = typeof body.username === 'string' ? body.username.trim() : '';
          if (!username || username.length > 24 || /[\u0000-\u001f]/.test(username)) {
            sendJson(response, 400, { error: 'Username phải có từ 1 đến 24 ký tự.' });
            return;
          }

          const store = readUsers();
          let user = store.users.find((entry) => entry.username.toLowerCase() === username.toLowerCase());
          if (pathname === '/api/login') {
            if (!user) {
              user = { username, characters: [] };
              store.users.push(user);
            }
            writeUsers(store);
            sendJson(response, 200, { user });
            return;
          }

          if (pathname === '/api/characters/evolve') {
            if (!user) {
              sendJson(response, 404, { error: 'Không tìm thấy username; hãy đăng nhập lại.' });
              return;
            }
            const characterId = typeof body.characterId === 'string' ? body.characterId : '';
            const character = user.characters.find((entry) => entry.id === characterId);
            if (!character) {
              sendJson(response, 404, { error: 'Không tìm thấy nhân vật.' });
              return;
            }
            if (isCharacterDueling(character.id)) {
              sendJson(response, 409, { error: 'Không thể tiến hóa khi đang tỷ thí.' });
              return;
            }
            if (body.currentEvolution !== character.evolution) {
              sendJson(response, 409, { error: 'Tiến hóa của nhân vật vừa được thay đổi; hãy tải lại.' });
              return;
            }
            const next = NEXT_CHARACTER_EVOLUTION[character.evolution];
            if (!next) {
              sendJson(response, 409, { error: 'Nhân vật đã đạt tiến hóa cao nhất.' });
              return;
            }
            character.evolution = next;
            character.stats = statsForEvolution(next);
            writeUsers(store);
            sendJson(response, 200, { character });
            return;
          }

          if (pathname !== '/api/characters') {
            sendJson(response, 404, { error: 'API không tồn tại.' });
            return;
          }
          if (!user) {
            sendJson(response, 404, { error: 'Không tìm thấy username; hãy đăng nhập lại.' });
            return;
          }
          if (user.characters.length >= 3) {
            sendJson(response, 409, { error: 'Mỗi username chỉ tạo tối đa 3 nhân vật.' });
            return;
          }
          if (!isOneOf(body.gender, genders)) {
            sendJson(response, 400, { error: 'Giới tính nhân vật không hợp lệ.' });
            return;
          }
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name || name.length > 20 || /[\u0000-\u001f]/.test(name)) {
            sendJson(response, 400, { error: 'Tên nhân vật phải có từ 1 đến 20 ký tự.' });
            return;
          }

          const character: PlayerCharacter = {
            id: randomUUID(),
            name,
            gender: body.gender as CharacterGender,
            baseSpecies: 'snake',
            evolution: 'snake',
            stats: statsForEvolution('snake')
          };
          user.characters.push(character);
          writeUsers(store);
          sendJson(response, 201, { user });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === 'JSON không hợp lệ.' || message === 'Nội dung yêu cầu không hợp lệ.' || message === 'Nội dung yêu cầu quá lớn.') {
            sendJson(response, message === 'Nội dung yêu cầu quá lớn.' ? 413 : 400, { error: message });
            return;
          }
          console.error('[Users API]', error);
          sendJson(response, 500, { error: 'Không thể đọc hoặc lưu users.json.' });
        }
      });
    }
  };
}

function pvpWebSocketPlugin(): Plugin {
  return {
    name: 'pvp-websocket-server',
    configureServer(server) {
      if (!(server.httpServer instanceof Server)) {
        throw new Error('PvP WebSocket cần HTTP server của Vite dev server.');
      }
      isCharacterDueling = attachPvpServer(server.httpServer, readUsers);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [usersJsonApi(), pvpWebSocketPlugin()],
    server: { port: 5173, open: true },
    build: { chunkSizeWarningLimit: 2000 },
    define: {
      __DEBUG__: JSON.stringify(env.DEBUG?.trim().toLowerCase() !== 'false')
    }
  };
});
