export function stringField(body, key) {
    const value = body[key];
    return typeof value === 'string' ? value : '';
}
export function listOf(body, key) {
    const raw = body[key];
    if (raw === undefined || raw === null)
        return [];
    return (Array.isArray(raw) ? raw : [raw]).map(value => typeof value === 'string' ? value : String(value));
}
export function idList(body, key) {
    return listOf(body, key).map(Number).filter(value => Number.isInteger(value) && value > 0);
}
// Los enlaces llegan como listas paralelas (`linkType`, `linkUrl`, `linkLabel`)
// más `linkPublic`, que lleva el índice de cada fila marcada: una casilla sin
// marcar no se envía y desalinearía las listas si compartiera su posición.
export function linkRows(body) {
    const types = listOf(body, 'linkType');
    const urls = listOf(body, 'linkUrl');
    const labels = listOf(body, 'linkLabel');
    const publicRows = new Set(idListAllowingZero(body, 'linkPublic'));
    const links = [];
    for (let index = 0; index < urls.length; index += 1) {
        const url = urls[index].trim();
        if (!url)
            continue;
        links.push({
            type: types[index]?.trim() || 'otro',
            label: labels[index] ?? null,
            url,
            isPublic: publicRows.has(index),
        });
    }
    return links;
}
function idListAllowingZero(body, key) {
    return listOf(body, key).map(Number).filter(value => Number.isInteger(value) && value >= 0);
}
