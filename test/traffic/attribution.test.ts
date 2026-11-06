import { describe, expect, it } from 'vitest';
import { attributionFromUrl, campaignTag, referringHost, resolveAttribution, type CampaignLink } from '../../src/traffic/attribution.js';

const origin = 'https://coleccionistasderockvenezolano.com';
describe('procedencia: normalización y privacidad', () => {
  it('descarta email, URLs, controles y etiquetas excesivas', () => {
    for (const value of ['persona@example.com', 'https://example.com', '=SUM(A1)', '<script>', 'x'.repeat(81), 'a\nb']) expect(campaignTag(value)).toBe('');
    expect(campaignTag(' Presentación Rock ')).toBe('presentación rock');
  });
  it('conserva solo el host externo; no tokens, usuario, puerto, query ni fragmento', () => {
    expect(referringHost('https://www.prensa.example:8443/privado?token=secreto#nombre', origin)).toBe('prensa.example');
    for (const value of [origin + '/login?token=x', 'https://www.coleccionistasderockvenezolano.com/x', 'javascript:alert(1)', 'http://127.0.0.1', 'http://localhost', 'https://user:pass@example.com']) expect(referringHost(value, origin)).toBe('');
  });
  it('extrae solo parámetros de campaña, sin activaciones ni consultas privadas', () => {
    const result = attributionFromUrl('/activar?token=secreto&q=persona&utm_source=Instagram&utm_medium=social&ref=bio', 'https://example.com/privado');
    expect(result).toMatchObject({ ref: 'bio', source: 'Instagram', medium: 'social' });
    expect(JSON.stringify(result)).not.toContain('secreto');
    expect(resolveAttribution(result, origin)).toMatchObject({ source: 'instagram', referrer: 'example.com', method: 'utm' });
  });
  it('el mapa de enlaces prevalece sobre UTM contradictorias, incluso archivado', () => {
    const link: CampaignLink = { id: 1, code: 'grupo-rock', label: 'Grupo', source: 'whatsapp', medium: 'grupo', campaign: 'presentacion', content: '', destination: '/', archived: true };
    expect(resolveAttribution({ source: 'spam', ref: 'grupo-rock' }, origin, link)).toMatchObject({ source: 'whatsapp', method: 'link', ref: 'grupo-rock' });
  });
  it('reconoce referentes y diferencia directo de enlaces sin registrar', () => {
    expect(resolveAttribution({ referrer: 'https://www.google.com/search?q=privado' }, origin)).toMatchObject({ source: 'google', medium: 'organic' });
    expect(resolveAttribution({ referrer: 'https://l.facebook.com/l.php?id=123' }, origin)).toMatchObject({ source: 'facebook', medium: 'social' });
    expect(resolveAttribution({ referrer: 'https://google.attacker.com/' }, origin)).toMatchObject({ source: 'google.attacker.com', medium: 'referral' });
    expect(resolveAttribution({ ref: 'sin-alta' }, origin)).toMatchObject({ source: 'unregistered-link', ref: 'sin-alta' });
    expect(resolveAttribution({}, origin)).toMatchObject({ source: 'direct', method: 'direct' });
  });
});
