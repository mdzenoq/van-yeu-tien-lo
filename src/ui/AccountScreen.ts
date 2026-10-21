import type { CharacterEvolution, PlayerCharacter, UserAccount } from '../types/accounts';
import { SPRITE_EVOLUTIONS } from '../config';

const MAX_CHARACTERS = 3;

export class AccountScreen {
  private readonly root = document.createElement('div');
  private user?: UserAccount;

  constructor(private readonly onEnterGame: (character: PlayerCharacter, username: string) => void) {
    this.root.className = 'account-screen';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '1000',
      display: 'grid',
      placeItems: 'center',
      padding: '24px',
      overflowY: 'auto',
      boxSizing: 'border-box',
      background: 'radial-gradient(ellipse at top, #34465b 0%, #1b2430 68%)',
      color: '#f4f7fb',
      fontFamily: 'system-ui, sans-serif'
    });
    document.body.append(this.root);
    this.showLogin();
  }

  destroy(): void {
    this.root.remove();
  }

  private showLogin(message = ''): void {
    const panel = this.createPanel();
    panel.append(this.heading('Đăng nhập'), this.paragraph('Nhập username để tiếp tục.'));
    const form = document.createElement('form');
    form.style.display = 'grid';
    form.style.gap = '14px';
    const username = document.createElement('input');
    username.type = 'text';
    username.name = 'username';
    username.placeholder = 'Username';
    username.autocomplete = 'username';
    username.maxLength = 24;
    username.required = true;
    this.styleInput(username);
    const submit = this.button('Đăng nhập', true, 'submit');
    form.append(username, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Đang đăng nhập...';
      try {
        const result = await this.request<{ user: UserAccount }>('/api/login', {
          username: username.value
        });
        this.user = result.user;
        this.showCharacters();
      } catch (error) {
        this.showLogin(this.errorMessage(error));
      }
    });
    panel.append(form);
    if (message) panel.append(this.errorText(message));
    this.root.replaceChildren(panel);
    username.focus();
  }

  private showCharacters(message = ''): void {
    const user = this.user;
    if (!user) {
      this.showLogin();
      return;
    }
    const panel = this.createPanel();
    panel.append(this.heading('Chọn nhân vật'), this.paragraph(`Xin chào, ${user.username}`));

    const list = document.createElement('div');
    list.style.display = 'grid';
    list.style.gap = '10px';
    user.characters.forEach((character) => {
      const select = this.button(
        `${character.name} · ${character.gender === 'male' ? 'Nam' : 'Nữ'} · ${this.evolutionLabel(character.evolution)}`
      );
      select.addEventListener('click', () => this.enterGame(character));
      list.append(select);
    });
    panel.append(list);

    if (user.characters.length < MAX_CHARACTERS) {
      const create = this.button('Tạo nhân vật mới');
      create.style.marginTop = '12px';
      create.addEventListener('click', () => this.showCreateCharacter());
      panel.append(create);
    } else {
      panel.append(this.paragraph('Đã đạt giới hạn 3 nhân vật.'));
    }

    const logout = this.button('Đổi username');
    logout.style.marginTop = '10px';
    logout.addEventListener('click', () => {
      this.user = undefined;
      this.showLogin();
    });
    panel.append(logout);
    if (message) panel.append(this.errorText(message));
    this.root.replaceChildren(panel);
  }

  private showCreateCharacter(message = ''): void {
    const user = this.user;
    if (!user) {
      this.showLogin();
      return;
    }
    if (user.characters.length >= MAX_CHARACTERS) {
      this.showCharacters('Mỗi username chỉ tạo tối đa 3 nhân vật.');
      return;
    }

    const panel = this.createPanel();
    panel.append(this.heading('Tạo nhân vật'));
    const form = document.createElement('form');
    form.style.display = 'grid';
    form.style.gap = '14px';
    const gender = this.selectField('Giới tính', [
      ['female', 'Nữ'],
      ['male', 'Nam']
    ]);
    const submit = this.button('Tạo và vào game', true, 'submit');
    form.append(
      gender.label,
      gender.select,
      this.paragraph('Loài gốc: Rắn. Tiến hóa sẽ được chọn sau và không thể đổi ngược.'),
      submit
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Đang tạo...';
      try {
        const result = await this.request<{ user: UserAccount }>('/api/characters', {
          username: user.username,
          gender: gender.select.value
        });
        this.user = result.user;
        const created = result.user.characters[result.user.characters.length - 1];
        if (!created) throw new Error('Máy chủ không trả về nhân vật vừa tạo.');
        this.enterGame(created);
      } catch (error) {
        this.showCreateCharacter(this.errorMessage(error));
      }
    });
    const back = this.button('Quay lại');
    back.addEventListener('click', () => this.showCharacters());
    panel.append(form, back);
    if (message) panel.append(this.errorText(message));
    this.root.replaceChildren(panel);
  }

  private async request<T>(url: string, body: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || `Yêu cầu thất bại (${response.status}).`);
    return result;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private evolutionLabel(evolution: CharacterEvolution): string {
    return SPRITE_EVOLUTIONS[evolution].label;
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('section');
    Object.assign(panel.style, {
      width: 'min(100%, 420px)',
      boxSizing: 'border-box',
      padding: '32px',
      border: '1px solid #52677e',
      borderRadius: '16px',
      background: 'rgba(19, 29, 41, 0.96)',
      boxShadow: '0 20px 70px #0008'
    });
    return panel;
  }

  private heading(value: string): HTMLHeadingElement {
    const heading = document.createElement('h1');
    heading.textContent = value;
    Object.assign(heading.style, { margin: '0 0 12px', fontSize: '28px' });
    return heading;
  }

  private paragraph(value: string): HTMLParagraphElement {
    const paragraph = document.createElement('p');
    paragraph.textContent = value;
    Object.assign(paragraph.style, { margin: '0 0 18px', color: '#c4cfdb' });
    return paragraph;
  }

  private errorText(value: string): HTMLParagraphElement {
    const error = this.paragraph(value);
    error.setAttribute('role', 'alert');
    error.style.color = '#ff9b9b';
    error.style.marginTop = '14px';
    return error;
  }

  private enterGame(character: PlayerCharacter): void {
    const username = this.user?.username;
    if (!username) {
      this.showLogin('Không tìm thấy tài khoản đang đăng nhập.');
      return;
    }
    this.root.remove();
    this.onEnterGame(character, username);
  }

  private button(
    label: string,
    primary = false,
    type: 'button' | 'submit' = 'button'
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = type;
    button.textContent = label;
    Object.assign(button.style, {
      minHeight: '44px',
      padding: '10px 14px',
      border: '1px solid #71859a',
      borderRadius: '8px',
      background: primary ? '#397c63' : '#2b3b4d',
      color: '#fff',
      font: 'inherit',
      cursor: 'pointer'
    });
    return button;
  }

  private styleInput(input: HTMLInputElement): void {
    Object.assign(input.style, {
      minHeight: '44px',
      padding: '10px 12px',
      boxSizing: 'border-box',
      border: '1px solid #71859a',
      borderRadius: '8px',
      background: '#101923',
      color: '#fff',
      font: 'inherit'
    });
  }

  private selectField(
    title: string,
    options: Array<[string, string]>
  ): { label: HTMLLabelElement; select: HTMLSelectElement } {
    const label = document.createElement('label');
    label.textContent = title;
    label.style.color = '#c4cfdb';
    const select = document.createElement('select');
    Object.assign(select.style, {
      minHeight: '44px',
      padding: '8px 12px',
      border: '1px solid #71859a',
      borderRadius: '8px',
      background: '#101923',
      color: '#fff',
      font: 'inherit'
    });
    for (const [value, text] of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    return { label, select };
  }

}
