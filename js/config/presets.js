// ==========================================
// PRESETS - Fluid configurations
// ==========================================

export const PRESETS = {
    water: {
        name: 'Eau',
        physics: {
            gravity: 1500,          // Increased gravity for heavier movement
            gasConst: 5000,         // Less compressible water
            nearGasConst: 10000,    // Stronger proximity repulsion
            viscosity: 2,           // Lower viscosity for realistic flow
            surfaceTension: 600     // Reduced surface tension
        },
        render: {
            waterColor: [0.10, 0.45, 0.75], // Natural marine blue
            deepColor: [0.02, 0.10, 0.25],  // Darker depths
            specularPower: 45,
            specularIntensity: 1.0,
            refractionStrength: 1.2,
            fresnelPower: 2.5,
            threshold: 0.18,
            particleSize: 22,              // Smaller particles for liquid appearance
            causticsEnabled: false,
            foamEnabled: true
        }
    },
    honey: {
        name: 'Miel',
        physics: {
            gravity: 500,           // gravité réduite pour écoulement lent
            gasConst: 1500,         // compressibilité basse = plus dense
            nearGasConst: 10000,    // forte répulsion de proximité pour éviter le stacking
            viscosity: 400,         // très visqueux
            surfaceTension: 2000    // haute tension de surface pour grosses gouttes
        },
        render: {
            waterColor: [0.85, 0.65, 0.12],
            deepColor: [0.55, 0.35, 0.05],
            specularPower: 60,
            specularIntensity: 1.2,
            refractionStrength: 0.3,
            fresnelPower: 2.0,
            threshold: 0.22,
            particleSize: 30,
            causticsEnabled: false,
            foamEnabled: false
        }
    },
    lava: {
        name: 'Lave',
        physics: {
            gravity: 400,
            gasConst: 2000,
            nearGasConst: 8000,
            viscosity: 300,
            surfaceTension: 1200
        },
        render: {
            waterColor: [0.95, 0.25, 0.05],
            deepColor: [0.4, 0.05, 0.01],
            specularPower: 20,
            specularIntensity: 0.5,
            refractionStrength: 0.1,
            fresnelPower: 1.5,
            threshold: 0.22,
            particleSize: 30,
            causticsEnabled: false,
            foamEnabled: true
        }
    },
    zerog: {
        name: 'Zero-G',
        physics: {
            gravity: 0,
            gasConst: 3000,
            nearGasConst: 6000,
            viscosity: 50,
            surfaceTension: 2500
        },
        render: {
            waterColor: [0.2, 0.6, 0.95],
            deepColor: [0.05, 0.15, 0.4],
            specularPower: 50,
            specularIntensity: 1.0,
            refractionStrength: 2.0,
            fresnelPower: 3.5,
            threshold: 0.18,
            particleSize: 26,
            causticsEnabled: false,
            foamEnabled: false
        }
    },
    mercury: {
        name: 'Mercure',
        physics: {
            gravity: 2500,
            gasConst: 4000,
            nearGasConst: 10000,
            viscosity: 20,
            surfaceTension: 3000
        },
        render: {
            waterColor: [0.75, 0.78, 0.82],
            deepColor: [0.3, 0.32, 0.35],
            specularPower: 80,
            specularIntensity: 2.0,
            refractionStrength: 0.5,
            fresnelPower: 5.0,
            threshold: 0.25,
            particleSize: 24,
            causticsEnabled: false,
            foamEnabled: false
        }
    },
    rain: {
        name: 'Pluie',
        physics: {
            gravity: 1800,
            gasConst: 2500,
            nearGasConst: 4000,
            viscosity: 40,
            surfaceTension: 500
        },
        render: {
            waterColor: [0.15, 0.5, 0.75],
            deepColor: [0.05, 0.12, 0.25],
            specularPower: 35,
            specularIntensity: 0.6,
            refractionStrength: 1.2,
            fresnelPower: 2.5,
            threshold: 0.15,
            particleSize: 22,
            causticsEnabled: false,
            foamEnabled: true
        }
    },
    // New test preset as requested by the plan's checkpoint
    test: {
        name: 'Test',
        physics: {
            gravity: 1000,
            gasConst: 3000,
            nearGasConst: 6000,
            viscosity: 100,
            surfaceTension: 1000
        },
        render: {
            waterColor: [0.5, 0.9, 0.2],
            deepColor: [0.1, 0.3, 0.05],
            specularPower: 40,
            specularIntensity: 1.0,
            refractionStrength: 1.0,
            fresnelPower: 2.0,
            threshold: 0.2,
            particleSize: 25,
            causticsEnabled: false,
            foamEnabled: false
        }
    }
};