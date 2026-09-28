export class PauseMenu {
  private el: HTMLElement;

  private simBtn: HTMLElement;

  constructor(parent: HTMLElement, handlers: { resume: () => void; restart: () => void; quit: () => void; simToEnd: () => void }) {
    this.el = document.createElement('div');
    this.el.className = 'overlay pause';
    this.el.innerHTML = `
      <div class="menu">
        <h1>PAUSED</h1>
        <button class="big" data-a="resume">Resume</button>
        <button class="big" data-a="sim">Sim to end of game</button>
        <button class="big" data-a="restart">Restart</button>
        <button class="big" data-a="quit">Quit to menu</button>
      </div>`;
    parent.appendChild(this.el);
    this.el.querySelector('[data-a=resume]')!.addEventListener('click', handlers.resume);
    this.el.querySelector('[data-a=restart]')!.addEventListener('click', handlers.restart);
    this.el.querySelector('[data-a=quit]')!.addEventListener('click', handlers.quit);
    this.simBtn = this.el.querySelector<HTMLElement>('[data-a=sim]')!;
    this.simBtn.addEventListener('click', handlers.simToEnd);
    this.hide();
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  show(inGame = false): void {
    this.simBtn.style.display = inGame ? '' : 'none';
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
