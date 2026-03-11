export const WAVES = [
  { wave: 1,  enemies: [{ type: 'scout', count: 3, interval: 3000 }] },
  { wave: 2,  enemies: [{ type: 'scout', count: 5, interval: 2500 }] },
  { wave: 3,  enemies: [{ type: 'scout', count: 4, interval: 2000 }, { type: 'heavy', count: 1, interval: 5000 }] },
  { wave: 5,  enemies: [{ type: 'heavy', count: 2, interval: 4000 }, { type: 'scout', count: 3, interval: 2000 }] },
  { wave: 10, boss: { type: 'juggernaut' }, enemies: [{ type: 'scout', count: 2, interval: 3000 }] },
]

export function getWaveConfig(waveNumber) {
  let config = WAVES[0]
  for (const w of WAVES) {
    if (w.wave <= waveNumber) config = w
    else break
  }
  return config
}
