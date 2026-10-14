# Lote Spotify sin foto: identidad y aplicación (2026-10-14)

El lote del 2026-10-03 capturó 113 artistas del catálogo SIN discos, casados solo por nombre exacto. Antes de
aplicar nada se cruzó cada captura con el catálogo (`ops/spotify-diario/identidad-lote.py`, sin llamar a Spotify):

- **confirmado**: perfil de Spotify ya verificado; o un disco, un título citado en la bio, dos pistas o una pista de ≥8 letras en común (nunca el nombre de la banda).
- **descartado**: el perfil verificado es otro; o el catálogo tiene pistas y ninguna aparece entre ≥5 lanzamientos de Spotify; o Spotify publica antes de que la banda se formara.
- **sin confirmar**: lo demás. No se aplicó.

Aplicación (`ops/spotify-diario/aplicar-captura.ts`, un run reversible por artista, runs 19641–19678): venezolanos con foto, discos, pistas y portadas; extranjeros solo foto (`--solo-foto`, pertinencia). Enlaces de Spotify (perfiles y discos de título idéntico): run 19679 (93 enlaces). Fotos y portadas localizadas con `npm run media:localize`.

## Confirmados (37)

| Artista | Origen | Por qué | Run | Discos | Pistas |
|---|---|---|---|---|---|
| Bloodwake (1217) | Venezuela | pistas ['shedding skin'] | 19641 | 1 | 1 |
| KungFu Club (2052) | Venezuela | discos ['3001']; pistas ['3001'] | 19642 | 0 | 0 |
| Versed (2053) | Venezuela | discos ['moire', 'prisma', 'visiones']; pistas ['aire'] | 19643 | 2 | 2 |
| Novo Color (2054) | Venezuela | discos ['anos salvajes', 'novo color vivo']; pistas ['purpura'] | 19644 | 1 | 5 |
| Dandy León (2055) | Venezuela | discos ['todo es bello']; pistas ['comprame'] | 19645 | 0 | 0 |
| La Pagana Trinidad (2058) | Venezuela | discos ['de donde vengo']; bio ['de donde vengo']; pistas ['cosas cursis'] | 19646 | 0 | 0 |
| José y El Toro (2061) | Venezuela | discos ['aqui todo esta bien', 'aunque esto se acabe', 'corazon']; bio ['exitos melodramat | 19647 | 20 | 20 |
| Zoller (2070) | Venezuela | bio ['la sintesis del ruido animal']; pistas ['inmortal'] | 19648 | 5 | 30 |
| Katkousu (2084) | Venezuela | pistas ['cenizas y conciencia'] | 19649 | 3 | 10 |
| Mustang 78 (2096) | Venezuela | bio ['de noche todos los carros son pacos']; pistas ['motorpunk'] | 19650 | 2 | 13 |
| CG Project (2127) | Venezuela | perfil de Spotify verificado | 19651 | 3 | 12 |
| Crónicas De Elyze (2156) | Venezuela | bio ['bye bye demmacrada s']; pistas ['distimia', 'ecos sin fin', 'el comienzo del caos'] | 19652 | 3 | 19 |
| ZaPiratz (2222) | Francia · solo foto | bio ['metal up your death'] | 19653 | 0 | 0 |
| LENGUAJE CAUSTICO (2286) | Venezuela | pistas ['mil formas'] | 19654 | 1 | 9 |
| FULERIOUS (2297) | Venezuela | pistas ['collateral'] | 19655 | 1 | 11 |
| Illya Kuryaki & The Valderramas (2324) | Argentina · solo foto | perfil de Spotify verificado | 19656 | 0 | 0 |
| Soda Stereo (2329) | Argentina · solo foto | perfil de Spotify verificado | 19657 | 0 | 0 |
| Always War (2338) | Suecia · solo foto | bio ['vengeance prevail', 'vultures chapter 1', 'vultures chapter 2']; pistas ['scatter th | 19658 | 0 | 0 |
| Suicide Silence (2340) | Estados Unidos · solo foto | perfil de Spotify verificado | 19659 | 0 | 0 |
| Rage (2342) | Alemania · solo foto | perfil de Spotify verificado | 19660 | 0 | 0 |
| Moonspell (2344) | Portugal · solo foto | perfil de Spotify verificado | 19661 | 0 | 0 |
| Nightrage (2345) | Suecia · solo foto | pistas ['insidious'] | 19662 | 0 | 0 |
| Possessed (2349) | Estados Unidos · solo foto | perfil de Spotify verificado | 19663 | 0 | 0 |
| Sun Traitors (2353) | Australia · solo foto | pistas ['eternity'] | 19664 | 0 | 0 |
| High Risk Strategy (2357) | Colombia · solo foto | bio ['labyrinth of the guilt complex']; pistas ['labyrinth of the guilt complex'] | 19665 | 0 | 0 |
| Amoklauf (2361) | Argentina · solo foto | bio ['mournful prophecies of a dying world'] | 19666 | 0 | 0 |
| Carnal Diafragma (2362) | República Checa · solo foto | pistas ['vykloktana klokani kloaka'] | 19667 | 0 | 0 |
| Cerebral Enema (2364) | Alemania · solo foto | perfil de Spotify verificado | 19668 | 0 | 0 |
| Nasty Surgeons (2366) | España · solo foto | perfil de Spotify verificado | 19669 | 0 | 0 |
| Cursed Burial (2379) | México · solo foto | pistas ['night of the disfigured pervert'] | 19670 | 0 | 0 |
| Meatknife (2387) | Alemania · solo foto | perfil de Spotify verificado | 19671 | 0 | 0 |
| Lord Piggy (2397) | México · solo foto | bio ['nino mostro'] | 19672 | 0 | 0 |
| Mordecai Mapper (2448) | Portugal · solo foto | perfil de Spotify verificado | 19673 | 0 | 0 |
| Skank (2469) | Brasil · solo foto | perfil de Spotify verificado | 19674 | 0 | 0 |
| Ekhymosis (2470) | Colombia · solo foto | perfil de Spotify verificado | 19675 | 0 | 0 |
| Plastilina Mosh (2472) | México · solo foto | perfil de Spotify verificado | 19676 | 0 | 0 |
| Van Halen (986) | Estados Unidos · solo foto | perfil de Spotify verificado | 19678 | 0 | 0 |

## Descartados (homónimos o nada en común con el catálogo) (24)

| Artista | Spotify | Lanzamientos | Motivo |
|---|---|---|---|
| Thorvald (1524) | [Thorvald](https://open.spotify.com/artist/7gsbcfFr7XfuZDsw3bV4hP) | 11 2020–2026 | 1 pista(s) del catálogo y ninguna entre 90 de Spotify |
| Mystica (2095) | [Mystica](https://open.spotify.com/artist/0h7lAQIDlgFPrB0Wpv0k2t) | 6 2014–2026 | 1 pista(s) del catálogo y ninguna entre 61 de Spotify |
| Loica (2105) | [Loïca](https://open.spotify.com/artist/2kCK9NogDIDEhWggoJRla7) | 7 2017–2025 | 1 pista(s) del catálogo y ninguna entre 20 de Spotify |
| La Iguana (2109) | [La Iguana](https://open.spotify.com/artist/0srLueoAuAoYsf1GJcFhQB) | 11 2008–2021 | 3 pista(s) del catálogo y ninguna entre 14 de Spotify |
| Impulsos (2129) | [Impulsos](https://open.spotify.com/artist/5fg51fQ7FAwi9bxvn9xAAx) | 14 2020–2025 | 1 pista(s) del catálogo y ninguna entre 41 de Spotify |
| Atentado (2131) | [Atentado](https://open.spotify.com/artist/5dVcOVUwsLk1nhf4Iv0ARS) | 8 2011–2024 | 1 pista(s) del catálogo y ninguna entre 51 de Spotify |
| OPPONENT (2180) | [Opponent](https://open.spotify.com/artist/4cSlo0UuPbN76e5N4mEeQb) | 14 2018–2025 | 1 pista(s) del catálogo y ninguna entre 36 de Spotify |
| Aurora (2194) | [AURORA](https://open.spotify.com/artist/1WgXqy2Dd70QQOU7Ay074N) | 92 2014–2026 | 1 pista(s) del catálogo y ninguna entre 194 de Spotify |
| Ares (2208) | [Ares](https://open.spotify.com/artist/1iRlPYW9AnnyLTPfy53Mj9) | 47 2017–2026 | 1 pista(s) del catálogo y ninguna entre 82 de Spotify |
| Vicio (2210) | [Vicio](https://open.spotify.com/artist/0Oj56DxuB7sN7viFGgFCU1) | 12 2018–2025 | 1 pista(s) del catálogo y ninguna entre 35 de Spotify |
| Harax (2212) | [Harax](https://open.spotify.com/artist/5yND5iEl0w6g6nbobzY7qf) | 45 2008–2026 | 1 pista(s) del catálogo y ninguna entre 55 de Spotify |
| Agrubio (2213) | [AGRubio](https://open.spotify.com/artist/6sQVtYqtkVy6aWFCSlAnoY) | 16 2024–2026 | 1 pista(s) del catálogo y ninguna entre 22 de Spotify |
| Panas (2230) | [Panas](https://open.spotify.com/artist/38zYa93TlioVnOnHrLtqvN) | 5 2020–2023 | 2 pista(s) del catálogo y ninguna entre 5 de Spotify |
| Mute (2256) | [Mute](https://open.spotify.com/artist/3hLIsgoNbqdaXgPZDF8Xfs) | 10 2002–2021 | 1 pista(s) del catálogo y ninguna entre 71 de Spotify |
| DEMOLITION (2260) | [Demolition](https://open.spotify.com/artist/6HwO6WsVoc0oFQ2kpdKlSM) | 7 2011–2020 | 1 pista(s) del catálogo y ninguna entre 46 de Spotify |
| D.E.S. (2300) | [D.E.S.](https://open.spotify.com/artist/1WUxI4txv937aVp21WL4vN) | 7 2016–2024 | 1 pista(s) del catálogo y ninguna entre 30 de Spotify |
| MEDUZA (2315) | [MEDUZA](https://open.spotify.com/artist/0xRXCcSX89eobfrshSVdyu) | 117 2019–2026 | 1 pista(s) del catálogo y ninguna entre 165 de Spotify |
| ZAIRE (2322) | [Zaire](https://open.spotify.com/artist/1AmDY7O7LAK1R46xJCLJ22) | 7 2024–2026 | 1 pista(s) del catálogo y ninguna entre 15 de Spotify |
| Molotov (2331) | [Molotov](https://open.spotify.com/artist/27Owkm4TGlMqb0BqaEt3PW) | 27 1997–2026 | 1 pista(s) del catálogo y ninguna entre 124 de Spotify |
| Angélica (2336) | [Angélica](https://open.spotify.com/artist/1UKSfUEDY2N9iYnbhOe4RJ) | 15 1988–2019 | 1 pista(s) del catálogo y ninguna entre 170 de Spotify |
| Piel de Lobo (2356) | [Piel de Lobo](https://open.spotify.com/artist/6FIDDP5qZi1H8qCuvLWDDZ) | 1 2016–2016 | Spotify publica desde 2016, la banda se formó en 2019 |
| CX9 (2411) | [CX9](https://open.spotify.com/artist/0c0JmtRdLyBW3F67MLhhkk) | 11 2020–2025 | 1 pista(s) del catálogo y ninguna entre 14 de Spotify |
| Cum Book (2418) | [Cum Book](https://open.spotify.com/artist/44fiDhijYcArB1p3Zy8ec2) | 6 2019–2023 | 1 pista(s) del catálogo y ninguna entre 37 de Spotify |
| Zoophilic Infection (2419) | [Zoophilic Infection](https://open.spotify.com/artist/29xJ2OzBq2I4I5UFjATXQi) | 8 2015–2023 | 1 pista(s) del catálogo y ninguna entre 68 de Spotify |

## Sin confirmar (pendientes de Brian) (52)

| Artista | Spotify | Lanzamientos | Motivo |
|---|---|---|---|
| Xarz (2062) | [Xarz](https://open.spotify.com/artist/2st0KLZsMejRRniPCS1yhd) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| TAK (2064) | [TAK](https://open.spotify.com/artist/51Ce3GImOKK2xAGi3HiNns) | 13 2024–2026 | 0 pista(s) del catálogo, 13 lanzamiento(s) en Spotify, sin coincidencias |
| Los Hippies (2074) | [Los Hippies](https://open.spotify.com/artist/2PNJtGXS4PSyVvonRYrVMi) | 2 2018–2019 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| Corriente Alterna (2088) | [Corriente Alterna](https://open.spotify.com/artist/42KPLLVqSkRm3SgX4CDTtF) | 1 2006–2006 | 3 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| AverlinG (2107) | [Averling](https://open.spotify.com/artist/7ECdAIrSPSjA6zUwyJ72rw) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Aula (2111) | [Aula](https://open.spotify.com/artist/4vP1bkyhc1LCNTDyAZBUE2) | 1 2018–2018 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Gas (2112) | [Gas](https://open.spotify.com/artist/2LLl3pDYbncYeq7lWFKr4X) | 1 1995–1995 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| XVirus (2118) | [XVIRUS](https://open.spotify.com/artist/0p9F3xlhJEgaqSyqhRnoHc) | 2 2022–2023 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| Vacteria (2128) | [Vacteria](https://open.spotify.com/artist/1HYW2Nk9nva0tfg5eoGgzC) | 1 2024–2024 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Efecto Violeta (2132) | [Efecto Violeta](https://open.spotify.com/artist/2wCWSghWbTPQ6hpuWoMmXl) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| SOUL OUT (2174) | [Soul Out](https://open.spotify.com/artist/1ZRZ4vHPj90uJSAVwWDw4w) | 1 2008–2008 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Latitud Zero (2189) | [Latitud Zero](https://open.spotify.com/artist/4CUAZ7iWxj25dD8LgiUBTU) | 2 2012–2023 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| La Naranja Mecánica (2192) | [La Naranja Mecanica](https://open.spotify.com/artist/5zGsN2QHuGnfUxMiXunYdL) | 1 2017–2017 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Opensky (2201) | [OpenSky](https://open.spotify.com/artist/1GuTlTHWmmKElerOH1AeeA) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Valery's (2202) | [Valery's](https://open.spotify.com/artist/3u4onF3HiXYRf5sFsIScI4) | 4 2021–2024 | 1 pista(s) del catálogo, 4 lanzamiento(s) en Spotify, sin coincidencias |
| Lord of Thunder (2220) | [Lord of Thunder](https://open.spotify.com/artist/6jEf0M5m8FZ0BIiFyfcrFh) | 1 2024–2024 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Mare Imbrium (2227) | [Mare Imbrium](https://open.spotify.com/artist/4xq3pTPkAIv9Lba2ULVQFz) | 4 2013–2023 | 0 pista(s) del catálogo, 4 lanzamiento(s) en Spotify, sin coincidencias |
| Proyecto Amber (2228) | [Proyecto Amber](https://open.spotify.com/artist/1OKALQRfTiyOY9k0Enmj46) | 1 2017–2017 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Orquesta Venezuela Pop (2234) | [Orquesta Venezuela Pop](https://open.spotify.com/artist/71NTi5i0Rc65LxRbzAea4l) | 0  | 2 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Miguel Ángel Fuster (2245) | [Miguel Angel Fuster](https://open.spotify.com/artist/1wUtcLr1SRCCS01i7jnYLr) | 0  | 3 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Jammas (2255) | [Jammas](https://open.spotify.com/artist/1V4t26faIIPSyf2dQVPgJO) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| UNDERCORE (2268) | [UNDERCORE](https://open.spotify.com/artist/0QXSzbA3ovQc0nDwMN2uAp) | 4 2024–2025 | 1 pista(s) del catálogo, 4 lanzamiento(s) en Spotify, sin coincidencias |
| ILUSIÓN SÓNICA (2275) | [Ilusión Sónica](https://open.spotify.com/artist/6L0gIll7Ro5oSV9tupGbzx) | 2 2022–2025 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| ADLIBITUM (2281) | [Adlibitum](https://open.spotify.com/artist/4JgG3b29tpXPPU9rQ48rMT) | 2 2000–2001 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| DOSIS (2290) | [Dosis](https://open.spotify.com/artist/4z5BlKH4gwAhgM4n5QHdeG) | 2 2021–2026 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| LOST GRAVITY (2308) | [Lost Gravity](https://open.spotify.com/artist/5dFuKMrUGC8hREmMVttdvE) | 3 2014–2023 | 1 pista(s) del catálogo, 3 lanzamiento(s) en Spotify, sin coincidencias |
| NECRONIUM (2309) | [Necronium](https://open.spotify.com/artist/2VbOJRXGnsQJp1gkMb9lDR) | 2 2022–2022 | 0 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| K2 (2320) | [K2](https://open.spotify.com/artist/7r8Qmu5hF5HbUpNDQ8ME2y) | 4 2003–2022 | 1 pista(s) del catálogo, 4 lanzamiento(s) en Spotify, sin coincidencias |
| ZOOCIEDAD VICIOSA (2323) | [Zoociedad Viciosa](https://open.spotify.com/artist/72aVifYrzXJ9MBzCebGPp0) | 1 2025–2025 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Cave of Swimmers (2339) | [Cave of Swimmers](https://open.spotify.com/artist/3LlmlJNg1y4q1EJmk88MIb) | 4 2013–2021 | 1 pista(s) del catálogo, 4 lanzamiento(s) en Spotify, sin coincidencias |
| Pikawa (2348) | [PIKAWA](https://open.spotify.com/artist/1jeMDeJd26TcUkX8pvmbmJ) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Gods of Silence (2350) | [Gods Of Silence](https://open.spotify.com/artist/1lhxnQ6BrfV6MMJNgPm1qm) | 3 2017–2017 | 1 pista(s) del catálogo, 3 lanzamiento(s) en Spotify, sin coincidencias |
| Anal Arcade (2368) | [Anal Arcade](https://open.spotify.com/artist/6G9IkrP4z3xzYtjvBAJ9Cm) | 4 2012–2024 | 1 pista(s) del catálogo, 4 lanzamiento(s) en Spotify, sin coincidencias |
| Hematoputrefaction Sexologicunt (2377) | [Hematoputrefaction Sexologicunt](https://open.spotify.com/artist/18wS3FOzozinI4T3hW3rpb) | 1 2022–2022 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Tripxss (2391) | [Tripxss](https://open.spotify.com/artist/0VZq02fYCwQXvNqr4luymR) | 1 2018–2018 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Vaginosis Bacteriana (2401) | [Vaginosis Bacteriana](https://open.spotify.com/artist/79rjaq93dXCPShYu3UWcLi) | 11 2014–2021 | 0 pista(s) del catálogo, 11 lanzamiento(s) en Spotify, sin coincidencias |
| Gorezadera (2405) | [Gorezadera](https://open.spotify.com/artist/5abWyrdNY0kqRl2kzalGvt) | 1 2016–2016 | 0 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| M.I.L.F (2406) | [M.I.L.F](https://open.spotify.com/artist/1p4Y4hOnZikrYojSTmf7MJ) | 2 2000–2019 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| Bassookah (2408) | [Bassookah](https://open.spotify.com/artist/2N64XnQhbocJ8VYkrqY4Aq) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Atomization (2413) | [Atomization](https://open.spotify.com/artist/7tw7hM4KTbu8gcGMySz6WA) | 21 2013–2026 | 0 pista(s) del catálogo, 21 lanzamiento(s) en Spotify, sin coincidencias |
| Prolapso (2423) | [Prolapso](https://open.spotify.com/artist/5Qro7k11V5fvVYZnSvhJ3G) | 1 2020–2020 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Rot in Space (2429) | [Rot in Space](https://open.spotify.com/artist/6BRqVcHYm0VcTxDqBODIHi) | 1 2015–2015 | 0 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Pinworm Infection (2431) | [Pinworm Infection](https://open.spotify.com/artist/0bqOHV703oMTZ1Wnj0vBa9) | 1 2023–2023 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Coprogasm (2439) | [Coprogasm](https://open.spotify.com/artist/23F2ODwH3JZOYCRWcmX7j1) | 1 2017–2017 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Kusari Gama Kill (2447) | [Kusari Gama Kill](https://open.spotify.com/artist/0pbfZahgLT7RG13DY43kUn) | 1 2026–2026 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| Individual Distortion (2449) | [Individual Distortion](https://open.spotify.com/artist/1lJ3dVcI6by293J4qAtpVi) | 6 2017–2025 | 0 pista(s) del catálogo, 6 lanzamiento(s) en Spotify, sin coincidencias |
| Meekness (2456) | [Meekness](https://open.spotify.com/artist/5oELIdhQVhoc41E3Qhua8l) | 2 2018–2020 | 1 pista(s) del catálogo, 2 lanzamiento(s) en Spotify, sin coincidencias |
| Luis Oberto (2462) | [Luis Oberto](https://open.spotify.com/artist/1ri16GmbU4rOAyHE3Sn7xj) | 1 1996–1996 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |
| La Fe Perdida (2463) | [La Fe Perdida](https://open.spotify.com/artist/3JvlizmmlVticbrjEQAlcO) | 0  | 3 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Grupo Espiga (2467) | [Grupo Espiga](https://open.spotify.com/artist/1a4MK88T0B6GirevihmBpv) | 0  | 1 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Grupo Syma (2468) | [Grupo Syma](https://open.spotify.com/artist/47L0yRSo4BOv4YQXn7U53u) | 0  | 2 pista(s) del catálogo, 0 lanzamiento(s) en Spotify, sin coincidencias |
| Asphixia (658) | [Asphixia](https://open.spotify.com/artist/7fCn2sdfgSgTMiCcqY2V9d) | 1 2025–2025 | 1 pista(s) del catálogo, 1 lanzamiento(s) en Spotify, sin coincidencias |

Los descartados quedan anotados: `ops/spotify-diario/diario.py` no los usa como perfil ni los vuelve a capturar.
