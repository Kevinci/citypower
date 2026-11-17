/**
 * Shared "lights on" factor for the whole scene: 0 by day, 1 at night (set every frame from
 * the game clock in Sky.tsx). Plain object so it can be handed to shaders as a uniform.
 */
export const NIGHT = { value: 0 };
export const setNight = (v: number) => {
  NIGHT.value = v;
};
