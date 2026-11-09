// The icons of the firmware (layout.ts ICONS) as SVG paths of Material Design Icons 7.4.47, the version whose font the
// firmware uses. Only these are imported, so the bundle keeps them and nothing else.
import React from 'react';

import {
    mdiAlarm,
    mdiBattery,
    mdiBed,
    mdiBell,
    mdiBlinds,
    mdiCar,
    mdiCeilingLight,
    mdiCheck,
    mdiClose,
    mdiCoffee,
    mdiDishwasher,
    mdiDoor,
    mdiFan,
    mdiFlash,
    mdiGarage,
    mdiHome,
    mdiLamp,
    mdiLightbulb,
    mdiLock,
    mdiLockOpen,
    mdiMovie,
    mdiMusic,
    mdiPause,
    mdiPlay,
    mdiPower,
    mdiPowerPlug,
    mdiRadiator,
    mdiShower,
    mdiSofa,
    mdiSolarPower,
    mdiSpeaker,
    mdiStop,
    mdiTelevision,
    mdiThermometer,
    mdiWashingMachine,
    mdiWaterPercent,
    mdiWeatherNight,
    mdiWeatherSunny,
    mdiWindowClosed,
    mdiWindowOpen,
} from '@mdi/js';

export const ICON_PATHS: Record<string, string> = {
    lightbulb: mdiLightbulb,
    lamp: mdiLamp,
    'ceiling-light': mdiCeilingLight,
    'power-plug': mdiPowerPlug,
    power: mdiPower,
    fan: mdiFan,
    radiator: mdiRadiator,
    thermometer: mdiThermometer,
    'water-percent': mdiWaterPercent,
    flash: mdiFlash,
    'solar-power': mdiSolarPower,
    battery: mdiBattery,
    'window-closed': mdiWindowClosed,
    'window-open': mdiWindowOpen,
    door: mdiDoor,
    garage: mdiGarage,
    blinds: mdiBlinds,
    lock: mdiLock,
    'lock-open': mdiLockOpen,
    bell: mdiBell,
    television: mdiTelevision,
    movie: mdiMovie,
    music: mdiMusic,
    speaker: mdiSpeaker,
    coffee: mdiCoffee,
    'washing-machine': mdiWashingMachine,
    dishwasher: mdiDishwasher,
    car: mdiCar,
    home: mdiHome,
    bed: mdiBed,
    sofa: mdiSofa,
    shower: mdiShower,
    'weather-sunny': mdiWeatherSunny,
    'weather-night': mdiWeatherNight,
    alarm: mdiAlarm,
    play: mdiPlay,
    pause: mdiPause,
    stop: mdiStop,
    check: mdiCheck,
    close: mdiClose,
};

/** One icon of the firmware; nothing for an unknown name */
export function TileIcon(props: { name: string; size: number; color: string }): React.JSX.Element | null {
    const path = ICON_PATHS[props.name];
    if (!path) {
        return null;
    }
    return (
        <svg
            width={props.size}
            height={props.size}
            viewBox="0 0 24 24"
            style={{ display: 'block', flex: 'none' }}
        >
            <path
                d={path}
                fill={props.color}
            />
        </svg>
    );
}
