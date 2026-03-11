export const UPGRADES = [
  { id: 'dmg_up',    type: 'passive', label: 'Munitions renforcées',  effect: { stat: 'damageMult',    value: 1.15 } },
  { id: 'spd_up',    type: 'passive', label: 'Turbines optimisées',   effect: { stat: 'speedMult',     value: 1.20 } },
  { id: 'hp_up',     type: 'passive', label: 'Coque renforcée',       effect: { stat: 'maxHpBonus',    value: 50   } },
  { id: 'rate_up',   type: 'passive', label: 'Canon rapide',          effect: { stat: 'fireRateMult',  value: 1.10 } },
  { id: 'torpedo',   type: 'weapon',  label: 'Torpille',              description: 'Missile AoE, explose à l\'impact' },
  { id: 'mine',      type: 'weapon',  label: 'Mine nautique',         description: 'Dépose une mine qui explose au contact' },
  { id: 'shockwave', type: 'weapon',  label: 'Vague de choc',         description: 'Explosion SPH radiale autour du bateau' },
  { id: 'dualgun',   type: 'weapon',  label: 'Canon double',          description: 'Tire en double rafale' },
]
