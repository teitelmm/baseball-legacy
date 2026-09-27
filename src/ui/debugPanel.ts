import GUI from 'lil-gui';
import { tuning } from '../core/tuning';

/** Tuning panel for testing (toggle with the backtick key). */
export function createDebugPanel(onChange: (key: string) => void): GUI {
  const gui = new GUI({ title: 'Debug & Tuning (`)' });
  const view = gui.addFolder('View');
  view.add(tuning, 'showZone').name('Strike zone');
  view.add(tuning, 'showTrail').name('Ball trail');
  view.add(tuning, 'showTimingMs').name('Timing in ms');
  view
    .add(tuning, 'timeScale', 0.1, 1, 0.05)
    .name('Game speed')
    .onChange(() => onChange('timeScale'));

  const diff = gui.addFolder('Difficulty overrides (0 = preset)');
  diff.add(tuning, 'timingScaleOverride', 0, 3, 0.05).name('Timing window ×');
  diff.add(tuning, 'pciScaleOverride', 0, 2, 0.05).name('PCI size ×').onChange(() => onChange('pci'));
  diff.add(tuning, 'contactAssistOverride', -1, 1, 0.05).name('Contact assist (-1 = preset)');
  diff.add(tuning, 'pitchGuide', ['auto', 'on', 'off']).name('Pitch guide');
  diff.add(tuning, 'timingOffsetMs', -80, 80, 1).name('Timing offset (ms)');
  diff.add(tuning, 'cpuRatingOverride', 0, 99, 1).name('CPU rating (next session)');

  const bat = gui.addFolder('Your batter');
  bat.add(tuning.userBatter, 'contact', 0, 100, 1).onChange(() => onChange('pci'));
  bat.add(tuning.userBatter, 'power', 0, 100, 1).onChange(() => onChange('ratings'));
  bat.add(tuning.userBatter, 'eye', 0, 100, 1).onChange(() => onChange('ratings'));

  const pit = gui.addFolder('Your pitcher');
  pit.add(tuning.userPitcher, 'velocity', 0, 100, 1).onChange(() => onChange('ratings'));
  pit.add(tuning.userPitcher, 'control', 0, 100, 1).onChange(() => onChange('ratings'));
  pit.add(tuning.userPitcher, 'movement', 0, 100, 1).onChange(() => onChange('ratings'));

  gui.hide();
  return gui;
}
