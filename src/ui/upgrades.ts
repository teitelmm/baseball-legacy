import { rating, RATING_LABEL, relevantKeys, upgrade, upgradeCost, type PlayerProfile, type RatingKey } from '../sim/profile';
import { h } from './home';

/**
 * Spend skill points: one row per rating with its bar, what you've added so far, and a
 * +1 button showing the cost. `onUpgrade` gets the upgraded player.
 */
export function upgradePanel(p: PlayerProfile, onUpgrade: (next: PlayerProfile, key: RatingKey) => void, disabled = false): HTMLElement {
  const pts = p.skillPoints ?? 0;
  const wrap = h('div', { class: 'upgrade-panel' });
  wrap.appendChild(
    h(
      'p',
      { class: 'muted' },
      'Earn skill points in every game you play: season games (simulated ones earn half) and exhibition games (half). Spend them here; higher ratings cost more.',
    ),
  );
  const list = h('div', { class: 'upgrades' });
  for (const k of relevantKeys(p)) {
    const v = rating(p, k);
    const cost = upgradeCost(v);
    const earned = p.progress?.[k] ?? 0;
    const row = h('div', { class: 'up-row' });
    row.innerHTML = `<span class="up-name">${RATING_LABEL[k]}</span><i class="bar"><i style="width:${v}%"></i></i><b>${v}</b><span class="muted up-earned">${earned ? `+${earned}` : ''}</span>`;
    const b = h('button', { type: 'button', 'data-up': k, 'aria-label': `Raise ${RATING_LABEL[k]} for ${cost} points` }, v >= 99 ? 'Maxed' : `+1 · ${cost} pts`);
    if (pts < cost || v >= 99 || disabled) b.setAttribute('disabled', '');
    b.addEventListener('click', () => {
      const next = upgrade(p, k);
      if (next) onUpgrade(next, k);
    });
    row.appendChild(b);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}
