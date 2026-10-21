export type CharacterGender = 'male' | 'female';
export type CharacterSpecies = 'snake';
export type CharacterEvolution = 'snake' | 'red-snake' | 'dragon';

export const NEXT_CHARACTER_EVOLUTION: Partial<Record<CharacterEvolution, CharacterEvolution>> = {
  snake: 'red-snake',
  'red-snake': 'dragon'
};

export interface PlayerCharacter {
  id: string;
  name: string;
  gender: CharacterGender;
  baseSpecies: CharacterSpecies;
  evolution: CharacterEvolution;
}

export interface UserAccount {
  username: string;
  characters: PlayerCharacter[];
}

export interface UserStore {
  users: UserAccount[];
}
