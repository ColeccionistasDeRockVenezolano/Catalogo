import type { CheerioAPI } from "cheerio";

export function isDecorativeImageUrl(raw:string):boolean{
  try{
    // Local catalog copies (/crv/media/…) are judged by their path like any other address.
    const url=raw.startsWith("/")&&!raw.startsWith("//")?new URL(raw,"https://catalog.invalid"):new URL(raw);
    return /(?:^|[/_.-])(?:logos?|favicons?|icons?|captcha|default_user|placeholder|tracking|pixel|wordmark|play|pause|descargar|download)(?:[/_.-]|$)/iu.test(url.pathname)
      || /[s_/=-](?:\d{1,2}|1\d{2})x(?:\d{1,2}|1\d{2})(?=[a-z_/.-]|$)/iu.test(`${url.pathname}${url.search}`);
  }catch{return true;}
}

export const VISUAL_RESOURCES_MARKER = "Recursos visuales de la página:";

/** Recursos declarados por el HTML; las dimensiones no implican inspección visual. */
export function pageImageResources($: CheerioAPI, pageUrl: string): string {
  const images = new Map<string, { url: string; description: string; width: number; height: number }>();
  const dimension = (raw: string | undefined) => /^\d+$/u.test(raw ?? "") ? Number(raw) : 0;
  const add = (raw: string | undefined, description: string, width = 0, height = 0) => {
    if (!raw) return;
    try {
      const url = new URL(raw, pageUrl);
      if (!/^https?:$/u.test(url.protocol) || url.username || url.password || isDecorativeImageUrl(url.href)) return;
      if (/\b(?:logo|favicon|icon|avatar-default|placeholder|tracking|pixel|captcha|default_user|wordmark)\b/iu.test(`${description} ${url.pathname}`)) return;
      if ((width > 0 && width < 200) || (height > 0 && height < 200)) return;
      const previous = images.get(url.href);
      if (!previous || width * (height || 1) > previous.width * (previous.height || 1)) images.set(url.href, { url: url.href, description: description.replace(/\s+/gu, " ").trim().slice(0, 300), width, height });
    } catch { /* Recurso no válido. */ }
  };
  $('meta[property="og:image"],meta[property="og:image:url"],meta[property="og:image:secure_url"],meta[name="twitter:image"],meta[property="twitter:image"]').each((_index, element) => {
    const meta = $(element);
    const property = meta.attr("property") ?? meta.attr("name") ?? "";
    const og = property.startsWith("og:");
    add(meta.attr("content"), og ? $('meta[property="og:image:alt"]').first().attr("content") ?? "Imagen principal declarada" : "Imagen social declarada",
      og ? dimension($('meta[property="og:image:width"]').first().attr("content")) : 0,
      og ? dimension($('meta[property="og:image:height"]').first().attr("content")) : 0);
  });
  $("img").each((_index, element) => {
    const img = $(element);
    const description = img.attr("alt") || img.attr("title") || img.closest("figure").find("figcaption").text() || "Imagen sin descripción";
    const width = dimension(img.attr("width")), height = dimension(img.attr("height"));
    add(img.attr("src"), description, width, height);
    add(img.attr("data-src") ?? img.attr("data-lazy-src"), description);
    add(img.attr("data-original"), description);
    add(img.attr("data-lazy"), description);
    const linked=img.closest("a[href]").attr("href");
    if(linked && /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/iu.test(linked))add(linked,description);

    const sets = [img.attr("srcset"), img.attr("data-srcset"), ...img.closest("picture").find("source").toArray().map(source => $(source).attr("srcset"))];
    for (const set of sets) for (const candidate of (set ?? "").split(",")) {
      const match = candidate.trim().match(/^(\S+)\s+(\d+(?:\.\d+)?)(w|x)$/u);
      if (match) {
        const candidateWidth = match[3] === "w" ? Number(match[2]) : width * Number(match[2]);
        const candidateHeight = match[3] === "x" ? height * Number(match[2]) : width && height ? Math.round(candidateWidth * height / width) : 0;
        add(match[1], description, candidateWidth, candidateHeight);
      }
    }
  });
  // ImageObject metadata can carry the original while <img> has only a thumbnail.
  $('script[type="application/ld+json"]').each((_index,element)=>{
    try{
      const visit=(value:unknown,depth=0):void=>{
        if(depth>12||!value||typeof value!=="object")return;
        if(Array.isArray(value)){value.forEach(v=>visit(v,depth+1));return;}
        const item=value as Record<string,unknown>;
        const description=[item["caption"],item["name"],item["description"]].find(v=>typeof v==="string") as string|undefined;
        if(item["@type"]==="ImageObject"){
          const raw=item["contentUrl"]??item["url"];
          if(typeof raw==="string")add(raw,description??"Imagen en metadatos",dimension(String(item["width"]??"")),dimension(String(item["height"]??"")));
        }
        if(typeof item["image"]==="string")add(item["image"],description??"Imagen en metadatos");
        Object.values(item).forEach(v=>visit(v,depth+1));
      };
      visit(JSON.parse($(element).text()));
    }catch{ /* Invalid structured metadata does not discard HTML images. */ }
  });
  const ranked = [...images.values()].sort((a, b) => b.width * (b.height || 1) - a.width * (a.height || 1));
  return `${VISUAL_RESOURCES_MARKER} ${ranked.length ? ranked.map(image => `Imagen: ${image.description} | URL: ${image.url} | Dimensiones declaradas: ${image.width || "desconocidas"} × ${image.height || "desconocidas"} px`).join(" · ") : "Sin imágenes documentadas."}`;
}
