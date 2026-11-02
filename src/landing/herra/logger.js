// Sustituto del registro de Herra: los módulos copiados solo avisan de datos raros.
const noop = () => undefined;
export const log = { info: noop, warn: noop, error: noop, debug: noop };
