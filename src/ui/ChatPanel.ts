import type { ChatMessage } from '../types/pvp';

type ChatChannel = 'all' | 'current' | 'system' | 'guild';

const CHANNELS: Array<{ id: ChatChannel; label: string }> = [
  { id: 'all', label: 'Tổng hợp' },
  { id: 'current', label: 'Hiện tại' },
  { id: 'guild', label: 'Tông môn' },
  { id: 'system', label: 'Hệ Thống' }
];

export class ChatPanel {
  private readonly root = document.createElement('section');
  private readonly messagesElement = document.createElement('div');
  private readonly form = document.createElement('form');
  private readonly input = document.createElement('input');
  private readonly errorElement = document.createElement('div');
  private readonly tabButtons = new Map<ChatChannel, HTMLButtonElement>();
  private messages: ChatMessage[] = [];
  private channel: ChatChannel = 'all';
  private connected = false;

  constructor(private readonly onSend: (channel: 'current' | 'guild', text: string) => void) {
    Object.assign(this.root.style, {
      position: 'fixed',
      left: '0px',
      bottom: '0px',
      zIndex: '50',
      width: 'min(360px, calc(100vw - 24px))',
      height: 'min(280px, 42vh)',
      minHeight: '190px',
      display: 'none',
      gridTemplateRows: '34px minmax(0, 1fr) auto auto',
      gap: '6px',
      padding: '8px',
      boxSizing: 'border-box',
      color: '#edf4fa',
      font: '13px system-ui, sans-serif',
      background: 'rgba(7, 17, 28, 0.94)',
      border: '1px solid #526a7e',
      borderRadius: '7px'
    });

    const tabs = document.createElement('nav');
    Object.assign(tabs.style, { display: 'flex', gap: '5px' });
    for (const item of CHANNELS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      Object.assign(button.style, {
        flex: '1',
        color: '#edf4fa',
        background: '#263b4d',
        border: '1px solid #587187',
        borderRadius: '4px',
        cursor: 'pointer'
      });
      button.addEventListener('click', () => {
        this.channel = item.id;
        this.render();
      });
      this.tabButtons.set(item.id, button);
      tabs.append(button);
    }

    Object.assign(this.messagesElement.style, {
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      overflowWrap: 'anywhere',
      padding: '3px'
    });
    this.errorElement.setAttribute('role', 'status');
    Object.assign(this.errorElement.style, { color: '#ffaaaa', minHeight: '15px' });

    Object.assign(this.form.style, { display: 'flex', gap: '5px' });
    this.input.type = 'text';
    this.input.maxLength = 50;
    this.input.placeholder = 'Nhập tin nhắn...';
    Object.assign(this.input.style, {
      minWidth: '0',
      flex: '1',
      color: '#fff',
      background: '#142332',
      border: '1px solid #526a7e',
      borderRadius: '4px',
      padding: '6px'
    });
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Gửi';
    Object.assign(send.style, {
      color: '#fff',
      background: '#32618a',
      border: '0',
      borderRadius: '4px',
      padding: '0 10px',
      cursor: 'pointer'
    });
    this.form.append(this.input, send);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.sendMessage();
    });
    this.root.append(tabs, this.messagesElement, this.errorElement, this.form);
    this.root.addEventListener('wheel', (event) => event.stopPropagation());
    document.body.append(this.root);
    this.render();
  }

  show(): void {
    this.root.style.display = 'grid';
  }

  destroy(): void {
    this.root.remove();
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.render();
  }

  addMessage(message: ChatMessage): void {
    this.messages.push(message);
    this.messages.sort((a, b) => a.sequence - b.sequence);
    this.render();
  }

  setError(message: string): void {
    this.errorElement.textContent = message;
  }

  private sendMessage(): void {
    const text = this.input.value.trim();
    if (!text || this.channel === 'system' || this.input.disabled) return;
    this.onSend(this.channel === 'guild' ? 'guild' : 'current', text);
    this.input.value = '';
  }

  private render(): void {
    for (const [channel, button] of this.tabButtons) {
      button.style.background = channel === this.channel ? '#426887' : '#263b4d';
      button.setAttribute('aria-pressed', String(channel === this.channel));
    }
    const visibleMessages = this.messages.filter(
      (message) => this.channel === 'all' || message.channel === this.channel
    );
    this.messagesElement.replaceChildren();
    for (const message of visibleMessages) {
      const line = document.createElement('div');
      const channelLabel =
        this.channel === 'all'
          ? ` [${CHANNELS.find((item) => item.id === message.channel)?.label ?? message.channel}]`
          : '';
      line.textContent = `${message.characterName} (${message.username})${channelLabel}: ${message.text}`;
      if (message.channel === 'system') line.style.color = '#f2d889';
      this.messagesElement.append(line);
    }
    this.messagesElement.scrollTop = this.messagesElement.scrollHeight;
    const systemChannel = this.channel === 'system';
    this.input.disabled = !this.connected || systemChannel;
    this.input.placeholder = systemChannel
      ? 'Kênh hệ thống chỉ để xem'
      : this.connected ? 'Nhập tin nhắn...' : 'Đang kết nối chat...';
    const send = this.form.querySelector('button');
    if (send) send.disabled = systemChannel || this.input.disabled;
  }
}
