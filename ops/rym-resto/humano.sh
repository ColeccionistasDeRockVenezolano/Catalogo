#!/bin/bash
# Puente RYM en el escritorio REAL del dueño (DISPLAY :0) — Firefox normal, visible.
#
# Diferencia con navegador.sh: allí el Firefox vive en un Xvfb (:96) y Cloudflare le sirve un
# reto «Verification» que nunca se resuelve (huella de render por software). Aquí el navegador
# corre en la pantalla real del dueño: si Cloudflare pide verificación, la ve y la resuelve, y
# la cola sigue sola. Todo lo demás (extensión, panel, /salud) es el mismo puente.
#
#   systemd-run --user --unit=crv-rym-humano --working-directory="$PWD" \
#     /bin/bash "$PWD/ops/rym-resto/humano.sh"
set -u
REPO="/home/brian/apps/Coleccionistas De Rock Venezolano"
export CRV_RYM_PERFIL="${CRV_RYM_PERFIL:-$HOME/.cache/crv-rym-humano}"
export CRV_RYM_DISPLAY="${CRV_RYM_DISPLAY:-:0}"
export CRV_RYM_PUERTO="${CRV_RYM_PUERTO:-8899}"
export CRV_RYM_DUENO="${CRV_RYM_DUENO:-brian}"

mkdir -p "$CRV_RYM_PERFIL/extensions"
# Misma sesión que el navegador del puente: si el perfil humano ya navegó RYM, sus cookies mandan.
if [ ! -f "$CRV_RYM_PERFIL/user.js" ]; then
  cat > "$CRV_RYM_PERFIL/user.js" <<'JS'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
JS
fi

exec /bin/bash "$REPO/ops/rym-resto/navegador.sh"
