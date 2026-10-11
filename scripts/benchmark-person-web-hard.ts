// Prueba difícil de la verificación web de personas (2026-10-06).
// Cada caso tiene la verdad confirmada en internet antes de entrar aquí:
//   · misma persona con nombres distintos, reconstruida desde el diario de la
//     fusión (la ficha descartada vuelve a tener su nombre y sus créditos);
//   · homónimos ya separados (runs 18011, 18110, 18116), incluidos padre e hijo;
//   · fichas mezcladas reales que nadie había detectado, y fichas de una sola
//     persona con carreras largas que NO deben salir como mezcladas.
// Solo lee el catálogo y la web; no guarda propuestas ni toca el core.
import { writeFileSync } from "node:fs";
import { closeDb, getPool } from "../src/db/client.js";
import { investigateKnownPersonPair, investigateMixedContext, investigatePersonContexts, personContext, pickProjects, type PersonContext } from "../src/ambiguity/person-web-verification.js";

type Verdict = "same" | "different" | "mixed" | "unknown";
type Truth = "same" | "different" | "mixed" | "single" | "doubtful";

interface PairCase { kind: "pair"; name: string; truth: Truth; accept: Verdict[]; a: number; b: number; }
interface MergedCase { kind: "merged"; name: string; truth: "same"; accept: Verdict[]; run: number; dropped: number; droppedName: string; kept: number; }
interface MixedCase { kind: "mixed"; name: string; truth: "mixed" | "single"; accept: Verdict[]; person: number; join?: number[]; }
type Case = PairCase | MergedCase | MixedCase;

const cases: Case[] = [
  // Misma persona, nombre distinto. Fuentes: bcv.org.ve, gladyspalmera.com (Nené Quintero);
  // cantantesdecabimas.blogspot.com, buenamusica.com (Neguito Borjas); facebook «Hoy en la Historia
  // del Pop Rock Venezolano» (Rudy Pagliuca: Malanga, Viniloversus, La Vida Bohème);
  // guaco.org y allaboutjazz (Rafael Greco, Patafunk «Dubdelic»); es.wikipedia Famasloop
  // (Alejandro «Piti» González); puntodecorte.net y ciudadfitopaez (Fito Páez produjo y tocó
  // teclados en «El amor ya no existe», 1987); rockhechovenezuela y noesfm (Joseíto Romero).
  { kind: "merged", name: "Nene Quintero / Carlos Quintero", truth: "same", accept: ["same"], run: 10594, dropped: 13340, droppedName: "Nene Quintero", kept: 3617 },
  { kind: "merged", name: "Neguito Borjas / Abdenago «Neguito» Borjas", truth: "same", accept: ["same"], run: 10552, dropped: 7818, droppedName: "Neguito Borjas", kept: 7814 },
  { kind: "merged", name: "Rudy Pagliuca / Rodolfo «Rudy» Pagliuca", truth: "same", accept: ["same", "mixed"], run: 10552, dropped: 662, droppedName: "Rudy Pagliuca", kept: 987 },
  { kind: "merged", name: "Rafael Grego (errata) / Rafael Greco", truth: "same", accept: ["same"], run: 10552, dropped: 1064, droppedName: "Rafael Grego", kept: 3259 },
  { kind: "merged", name: "Piti / Alejandro «Piti» González", truth: "same", accept: ["same"], run: 13285, dropped: 2671, droppedName: "Piti", kept: 2668 },
  { kind: "merged", name: "Rodolfo «Fito» Paez / Fito Páez", truth: "same", accept: ["same"], run: 10552, dropped: 2819, droppedName: "Rodolfo \"Fito\" Paez", kept: 1434 },
  // Fuera de la puntuación: la ficha conservada (486) junta a Joseíto con su padre José Romero Bello (Discogs
  // 3446288: «father of arpa player Joseito Romero»), así que «misma» y «distintas» son las dos defendibles.
  // La 486 se prueba como mezclada en su propio caso.
  // Homónimos separados a mano, con sus fuentes en docs/decisions/2026-10-06-*.json.
  { kind: "pair", name: "Víctor Valerio: Niuno Niotro / ingeniero 1978", truth: "different", accept: ["different"], a: 1294, b: 40353 },
  { kind: "pair", name: "James Brown: cantante / ingeniero de Caramelos", truth: "different", accept: ["different"], a: 4531, b: 40360 },
  { kind: "pair", name: "Alfredo Gil: trompeta salsa / metal 2007", truth: "different", accept: ["different"], a: 376, b: 40375 },
  { kind: "pair", name: "Kenny: Las Cuatro Monedas / Coprophagist", truth: "different", accept: ["different"], a: 6215, b: 40377 },
  { kind: "pair", name: "Antonio Casas: hijo (Rawayana) / padre (Wahala)", truth: "different", accept: ["different"], a: 1460, b: 40386 },
  { kind: "pair", name: "Jorge Medina: Evil Reborn / Grupo Vera", truth: "different", accept: ["different"], a: 13298, b: 40376 },
  { kind: "pair", name: "Jesús Hernández: violinista / metal Maturín", truth: "different", accept: ["different"], a: 4409, b: 40379 },
  { kind: "pair", name: "Rafael Rodríguez: ACME / Gallery of Souls", truth: "different", accept: ["different"], a: 4382, b: 40387 },
  { kind: "pair", name: "Enrique García: Mata Rica / Neo Noir", truth: "different", accept: ["different"], a: 3207, b: 40388 },
  { kind: "pair", name: "Armando Álvarez: Sevillano 1977 / Gaêlica", truth: "different", accept: ["different"], a: 1179, b: 40389 },
  { kind: "pair", name: "«Cheo» Rodríguez (Desorden) / «Cheo» Valenzuela (Dimensión Latina)", truth: "different", accept: ["different"], a: 1112, b: 24879 },
  { kind: "pair", name: "Ezequiel Serrano: padre (Calderón) / hijo (Valencia)", truth: "different", accept: ["different"], a: 2568, b: 883 },
  // Era «dudoso» al separarlo («puede ser el mismo bajista, sin confirmar»). Metal Archives lo confirma: el músico
  // 933907 es bajista de Oblivion of Hybrids y de Sacrilegio, y las dos bandas se remiten («See also: ex-…»).
  { kind: "pair", name: "Francisco González: Oblivion / Sacrilegio", truth: "same", accept: ["same"], a: 40356, b: 40357 },
  // Fichas mezcladas reales: 486 junta a José Romero Bello (1922–1998, Adilia Castillo) con
  // Joseíto Romero (n. 1952); 987 tiene Los Dangers 1965 (banda de Rudy Márquez) y Rudy Pagliuca nació en 1971.
  { kind: "mixed", name: "José Romero 486: Romero Bello + Joseíto", truth: "mixed", accept: ["mixed"], person: 486 },
  { kind: "mixed", name: "Rudy Pagliuca 987: + Los Dangers 1965", truth: "mixed", accept: ["mixed"], person: 987 },
  // Mezcladas reconstruidas: las fichas que se separaron a mano, juntas otra vez como estaban.
  { kind: "mixed", name: "Víctor Valerio juntado (2010 + ingeniero 1978)", truth: "mixed", accept: ["mixed"], person: 1294, join: [40353] },
  { kind: "mixed", name: "Alfredo Gil juntado (trompeta + metal)", truth: "mixed", accept: ["mixed"], person: 376, join: [40375] },
  { kind: "mixed", name: "Antonio Casas juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 1460, join: [40386] },
  // Nené Quintero (3617) se creía una sola persona, pero tiene la mezcla y masterización de Los Beat3 «¡En Vivo!» (2010),
  // que según el librito son de Carlos Kinttero, bajista del grupo (hippitoysuschatarritas.blogspot.com, 2012/09).
  // El verificador lo vio primero; se corrigió la etiqueta el 2026-10-10 con esa fuente.
  { kind: "mixed", name: "Carlos «Nené» Quintero 3617: + mezcla de Los Beat3 (Kinttero)", truth: "mixed", accept: ["mixed"], person: 3617 },
  // Una sola persona con carrera larga: no deben salir mezcladas.
  { kind: "mixed", name: "Neguito Borjas 1982–2023 (una persona)", truth: "single", accept: ["unknown"], person: 7814 },
  { kind: "mixed", name: "Rafael Greco 1988–2014 (una persona)", truth: "single", accept: ["unknown"], person: 3259 },
];

// Validación aparte (HOLDOUT=1): casos que no se usaron para ajustar las reglas. Fusiones de las runs 10552 y
// 13285 con proyecto común, los demás homónimos de las runs 18011/18110 y fichas de una sola persona.
const holdout: Case[] = [
  { kind: "merged", name: "Chu Quintero / Jesús «Chu» Quintero", truth: "same", accept: ["same"], run: 13285, dropped: 33747, droppedName: "Chu Quintero", kept: 2660 },
  { kind: "merged", name: "Pitufo Vivas / Francisco «Pitufo» Vivas", truth: "same", accept: ["same"], run: 10552, dropped: 6636, droppedName: "Pitufo Vivas", kept: 2686 },
  { kind: "merged", name: "Jesús Campos / Jesús Esteban Campos", truth: "same", accept: ["same"], run: 13285, dropped: 36970, droppedName: "Jesús Campos", kept: 2311 },
  { kind: "merged", name: "Juan Trujillo / Juan Carlos Trujillo", truth: "same", accept: ["same"], run: 13285, dropped: 12735, droppedName: "Juan Trujillo", kept: 2694 },
  { kind: "merged", name: "Marco Tulio Ciargo Sarri / Marco Ciargo", truth: "same", accept: ["same"], run: 13285, dropped: 6371, droppedName: "Marco Tulio Ciargo Sarri", kept: 2945 },
  { kind: "merged", name: "Andrés Sucre / Andrés Eduardo Sucre", truth: "same", accept: ["same"], run: 13285, dropped: 35019, droppedName: "Andrés Sucre", kept: 1510 },
  { kind: "merged", name: "Julio Alonzo / Julio «Mal Tripear Jamás» Alonso", truth: "same", accept: ["same"], run: 10552, dropped: 6150, droppedName: "Julio Alonzo", kept: 3069 },
  { kind: "merged", name: "Edgar Quinteor (errata) / Édgar Quintero", truth: "same", accept: ["same"], run: 10552, dropped: 13067, droppedName: "Edgar Quinteor", kept: 4026 },
  { kind: "merged", name: "Chego Cabrices / José «Chego» Cabrices", truth: "same", accept: ["same"], run: 13285, dropped: 25207, droppedName: "Chego Cabrices", kept: 3875 },
  { kind: "pair", name: "Francisco González: Niuno Niotro / ingeniero Fidelis", truth: "different", accept: ["different"], a: 1298, b: 40354 },
  { kind: "pair", name: "Francisco González: Niuno Niotro / «Pacho» Recoveco", truth: "different", accept: ["different"], a: 1298, b: 40355 },
  { kind: "pair", name: "Francisco González: ingeniero Fidelis / Oblivion of Hybrids", truth: "different", accept: ["different"], a: 40354, b: 40356 },
  { kind: "pair", name: "«Cheo» Rodríguez / Cheo Navarro (Grupo Mango)", truth: "different", accept: ["different"], a: 1112, b: 21473 },
  { kind: "pair", name: "«Cheo» Rodríguez / Cheo García (Billo's)", truth: "different", accept: ["different"], a: 1112, b: 26725 },
  { kind: "pair", name: "«Cheo» Rodríguez / «Cheo» Morillo (Klasse)", truth: "different", accept: ["different"], a: 1112, b: 40380 },
  { kind: "pair", name: "«Cheo» Rodríguez / José Luis «Cheo» Pardo", truth: "different", accept: ["different"], a: 1112, b: 386 },
  { kind: "pair", name: "Kenny O'Brien / Kenny de Serenata Guayanesa", truth: "doubtful", accept: ["different", "unknown"], a: 6215, b: 40378 },
  { kind: "mixed", name: "Jorge Medina juntado (Evil Reborn + Grupo Vera)", truth: "mixed", accept: ["mixed"], person: 13298, join: [40376] },
  { kind: "mixed", name: "Kenny juntado (Cuatro Monedas + Coprophagist)", truth: "mixed", accept: ["mixed"], person: 6215, join: [40377] },
  { kind: "mixed", name: "Jesús Hernández juntado (violín + metal)", truth: "mixed", accept: ["mixed"], person: 4409, join: [40379] },
  { kind: "mixed", name: "Rafael Rodríguez juntado (ACME + Gallery of Souls)", truth: "mixed", accept: ["mixed"], person: 4382, join: [40387] },
  { kind: "mixed", name: "Enrique García juntado (Mata Rica + Neo Noir)", truth: "mixed", accept: ["mixed"], person: 3207, join: [40388] },
  { kind: "mixed", name: "Armando Álvarez juntado (Sevillano 1977 + Gaêlica)", truth: "mixed", accept: ["mixed"], person: 1179, join: [40389] },
  { kind: "mixed", name: "James Brown juntado (cantante + ingeniero)", truth: "mixed", accept: ["mixed"], person: 4531, join: [40360] },
  { kind: "mixed", name: "Francisco González juntado (Niuno Niotro + ingeniero)", truth: "mixed", accept: ["mixed"], person: 1298, join: [40354] },
  { kind: "mixed", name: "«Cheo» Rodríguez juntado (+ Cheo Navarro)", truth: "mixed", accept: ["mixed"], person: 1112, join: [21473] },
  { kind: "mixed", name: "Pablo Manavello (una persona)", truth: "single", accept: ["unknown"], person: 39 },
  { kind: "mixed", name: "Michel Chazet (una persona)", truth: "single", accept: ["unknown"], person: 556 },
  { kind: "mixed", name: "José Luis «Caplís» Chacín (una persona)", truth: "single", accept: ["unknown"], person: 483 },
  { kind: "mixed", name: "Jesús «Chu» Quintero (una persona)", truth: "single", accept: ["unknown"], person: 2660 },
];

// Conjunto fresco (FRESH=1, 2026-10-06): armado DESPUÉS de cerrar las reglas y sin ajustar nada con él.
// Fusiones confirmadas en la web: es.wikipedia «Mayra Martí» (nombre real Moira Elisa Martínez Álvarez);
// en.wikipedia «Freddy Marshall» (Freddy Cabezas Álvarez, guitarra de Arkangel); ra.co / mn2s (Baffa = Emidio
// Falconi, Sur Carabela); last.fm y venciclopedia (Juan Bautista López «Yátu», Seguridad Nacional, Trance
// Nuance); tycoonpercussion y cibercuba (Robert Vilera, percusionista); dejaronhuellas y rockasteria (Rubén
// «Micho» Correa en Spiteri 1973); cronicasdeltanatos y el-carabobeno (Gonzalo «Chile» Veloz, El Medio Evo);
// tycoonpercussion y lasalsaesmivida (Joel «Pibo» Márquez). Homónimos: el de metal nació (Metal Archives)
// después de los créditos de la otra ficha. Héctor Cabrera (1932–2003) cantó con Torrealba: verificado antes.
const fresh: Case[] = [
  { kind: "merged", name: "Mayra Martí / Moira Elisa Martínez Álvarez", truth: "same", accept: ["same"], run: 13285, dropped: 25431, droppedName: "Mayra Martí", kept: 11915 },
  { kind: "merged", name: "Freddy Cabezas / Marshall", truth: "same", accept: ["same"], run: 13285, dropped: 2021, droppedName: "Freddy Cabezas", kept: 7910 },
  { kind: "merged", name: "Dj Baffa / Emidio Falconi", truth: "same", accept: ["same"], run: 13285, dropped: 1553, droppedName: "Dj Baffa", kept: 669 },
  { kind: "merged", name: "Yátu / Juan Bautista López", truth: "same", accept: ["same"], run: 13285, dropped: 3765, droppedName: "Yátu", kept: 1003 },
  { kind: "merged", name: "Robert Vilera / Robert Vilela", truth: "same", accept: ["same"], run: 13285, dropped: 21839, droppedName: "Robert Vilera", kept: 8610 },
  { kind: "merged", name: "Micho / Rubén «Micho» Correa", truth: "same", accept: ["same"], run: 13285, dropped: 2121, droppedName: "Micho", kept: 29 },
  { kind: "merged", name: "Chile Veloz / Gonzalo «Chile» Veloz", truth: "same", accept: ["same"], run: 10552, dropped: 6246, droppedName: "Chile Veloz", kept: 13325 },
  { kind: "merged", name: "Joel Márquez / Joel «Pibo» Márquez", truth: "same", accept: ["same"], run: 13285, dropped: 20843, droppedName: "Joel Márquez", kept: 6864 },
  { kind: "pair", name: "Héctor Cabrera: intérprete 1962 / cantante de Torrealba", truth: "same", accept: ["same"], a: 11886, b: 27255 },
  { kind: "pair", name: "Luis Flores: metal (n. 1999) / compositor e ingeniero", truth: "different", accept: ["different"], a: 2591, b: 22966 },
  { kind: "pair", name: "Jorge Rangel: batería (n. 1985) / timbal Batakum 1984", truth: "different", accept: ["different"], a: 13750, b: 25058 },
  { kind: "pair", name: "Daniel Gil: bajo (n. 1993) / cuatro de Cecilia Todd 1987", truth: "different", accept: ["different"], a: 13947, b: 30434 },
  // La 2012 junta grabación de 1996 (el de Nocturnal tendría 13 años) con un bajo de 2002 que no se pudo atribuir.
  { kind: "pair", name: "Luis Rojas: Nocturnal (n. 1983) / ingeniero de Huáscar Barradas", truth: "doubtful", accept: ["different", "unknown"], a: 13784, b: 2012 },
  { kind: "mixed", name: "Luis Flores juntado (metal + compositor)", truth: "mixed", accept: ["mixed"], person: 2591, join: [22966] },
  { kind: "mixed", name: "Jorge Rangel juntado (batería + Batakum)", truth: "mixed", accept: ["mixed"], person: 13750, join: [25058] },
  { kind: "mixed", name: "Daniel Gil juntado (bajo + cuatro)", truth: "mixed", accept: ["mixed"], person: 13947, join: [30434] },
  { kind: "mixed", name: "Freddy «Marshall» Cabezas (una persona)", truth: "single", accept: ["unknown"], person: 7910 },
  { kind: "mixed", name: "Mayra Martí 1967–2005 (una persona)", truth: "single", accept: ["unknown"], person: 11915 },
  { kind: "mixed", name: "Yátu 1980–2011 (una persona)", truth: "single", accept: ["unknown"], person: 1003 },
  { kind: "mixed", name: "Joel «Pibo» Márquez (una persona)", truth: "single", accept: ["unknown"], person: 6864 },
  { kind: "mixed", name: "Robert Vilera 1993–2019 (una persona)", truth: "single", accept: ["unknown"], person: 8610 },
];
// Segundo conjunto fresco (FRESH=2): armado después de corregir lo que el primero destapó (seudónimos), sin ajustar
// nada con él. Fuentes: elcooperante y arepavolatil (Abraham «Cangrejo» García: Seguridad Nacional, Dermis Tatú);
// noesfm y coleccionistasderockvenezolano (Nörton Pérez: La Puta Eléctrica, Pixel, Jacktürbo); es.wikipedia y
// ladosis (Pablo «Chino» Agreda, Tomates Fritos); sincopa (Pedro Castillo, Aditus); Rawayana (Alberto «Beto»
// Montenegro); Brian «Big Bass» Gardner, masterizador (Bernie Grundman). Padre e hijo: elimpulso y tendencia
// (Sundín Galué padre, Guaco, m. 2009; el hijo canta en Tecupae 1999–2011); venezuelatuya y asieravenezuela
// (Juan Vicente Torrealba León, hijo de Juan Vicente Torrealba). Una persona: separaciones ya corregidas.
const fresh2: Case[] = [
  { kind: "merged", name: "Abraham «Cangrejo» García / Abraham García", truth: "same", accept: ["same"], run: 10448, dropped: 1636, droppedName: 'Abraham "Cangrejo" García', kept: 2415 },
  { kind: "merged", name: "Nörton «Mars» Pérez / Norton Pérez", truth: "same", accept: ["same"], run: 10448, dropped: 2766, droppedName: 'Nörton "Mars" Pérez', kept: 372 },
  { kind: "merged", name: "Pablo Chino Agreda / Pablo «Chino» Agreda", truth: "same", accept: ["same"], run: 11813, dropped: 25214, droppedName: "Pablo Chino Agreda", kept: 775 },
  { kind: "merged", name: "P. Castillo / Pedro Castillo (Aditus)", truth: "same", accept: ["same"], run: 4063, dropped: 13174, droppedName: "P. Castillo", kept: 38 },
  { kind: "merged", name: "Alberto «Beto» Montenegro / Alberto Montenegro", truth: "same", accept: ["same"], run: 10448, dropped: 384, droppedName: 'Alberto "Beto" Montenegro', kept: 730 },
  { kind: "merged", name: "Brian «Big Bass» Gardner / Brian Gardner", truth: "same", accept: ["same"], run: 10448, dropped: 1283, droppedName: 'Brian "Big Bass" Gardner', kept: 739 },
  { kind: "pair", name: "Sundín Galué: padre (Guaco) / hijo (Tecupae)", truth: "different", accept: ["different"], a: 9341, b: 35166 },
  { kind: "pair", name: "Juan Vicente Torrealba / Juan Vicente Torrealba Hijo", truth: "different", accept: ["different"], a: 4456, b: 31940 },
  { kind: "mixed", name: "Sundín Galué juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 9341, join: [35166] },
  { kind: "mixed", name: "Juan Vicente Torrealba juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 4456, join: [31940] },
  { kind: "mixed", name: "Abraham «Cangrejo» García (una persona)", truth: "single", accept: ["unknown"], person: 2415 },
  { kind: "mixed", name: "Norton Pérez 1995–2011 (una persona)", truth: "single", accept: ["unknown"], person: 372 },
  { kind: "mixed", name: "Pedro Castillo 1979–2023 (una persona)", truth: "single", accept: ["unknown"], person: 38 },
  // Cayayo Troconis murió en 1999 y toca como invitado en «Debut» (2001) de Sur Carabela, grabado antes.
  { kind: "mixed", name: "Cayayo Troconis (una persona, crédito póstumo)", truth: "single", accept: ["unknown"], person: 645 },
  { kind: "mixed", name: "Víctor Mestas (una persona)", truth: "single", accept: ["unknown"], person: 3244 },
  { kind: "mixed", name: "Nelson Arrieta (una persona)", truth: "single", accept: ["unknown"], person: 3622 },
];
// Tercer conjunto fresco (FRESH=3): después de la regla de «Hijo»/«Jr.», sin ajustar nada con él. Fuentes:
// galletascalientes y sincopa (Alejandro «Chonto» Turola: Circo Vulkano, Papashanty); elestimulo (Jeremías Ruiz);
// solarlatinclub (Luis «Papo» Márquez, trompetista cubano en Venezuela desde 1991); sincopa «Mis Aguinaldos» 2007
// (Hernán Gamboa y su hijo Hernán Gamboa Jr.); bandcamp de Tomates Fritos (el solo de Rhodes de «Perdóname» es de
// Alfred Gómez Jr.: la ficha «Alfred Gómez» es él; la regla de «Jr.» obliga a abstenerse, y cuenta como fallo).
const fresh3: Case[] = [
  { kind: "merged", name: "Chonto Turola / Alejandro «Chonto» Turola", truth: "same", accept: ["same"], run: 10594, dropped: 3331, droppedName: "Chonto Turola", kept: 120 },
  { kind: "merged", name: "Jeremy Ruiz / Jeremías «Jeremy» Ruiz", truth: "same", accept: ["same"], run: 10552, dropped: 12728, droppedName: "Jeremy Ruiz", kept: 1912 },
  { kind: "merged", name: "Luis «Papo» Márquez / Luis Márquez", truth: "same", accept: ["same"], run: 10448, dropped: 896, droppedName: 'Luis "Papo" Márquez', kept: 794 },
  { kind: "pair", name: "Alfred Gómez / Alfred Gómez Jr. (la misma persona)", truth: "same", accept: ["same"], a: 3096, b: 1505 },
  { kind: "pair", name: "Hernán Gamboa / Hernán Gamboa Jr. (padre e hijo)", truth: "different", accept: ["different"], a: 913, b: 31719 },
  { kind: "mixed", name: "Hernán Gamboa juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 913, join: [31719] },
  { kind: "mixed", name: "Hernán Gamboa 1971–2016 (una persona)", truth: "single", accept: ["unknown"], person: 913 },
  { kind: "mixed", name: "Jeremías Ruiz (una persona)", truth: "single", accept: ["unknown"], person: 1912 },
  { kind: "mixed", name: "Alejandro «Chonto» Turola (una persona)", truth: "single", accept: ["unknown"], person: 120 },
  { kind: "mixed", name: "Luis «Papo» Márquez (una persona)", truth: "single", accept: ["unknown"], person: 794 },
];
// Cuarto conjunto fresco (FRESH=4): después de repartir los 40 discos por toda la carrera, sin ajustar nada con él.
// Fuentes: venezuelaehistoria y americat (Francisco Pacheco y su hijo Francisco Pacheco Castro, cantante en
// «Francisco Pacheco y su Pueblo»); es.wikipedia y elmiope (Luis Arismendi, fundador de la Rondalla Venezolana,
// m. 2020; su hijo Luis Enrique la dirige); ciudadccs (Víctor «Kasino» González, La Misma Gente); curadas.com
// (Rafael «El Gallo» Velásquez, trompetista, murió en octubre de 2009: la ficha 8842 tiene además grabaciones
// 2000–2003 y un diseño gráfico de 2014, de otra persona).
const fresh4: Case[] = [
  { kind: "merged", name: "Victor González «Kasino» / Victor González", truth: "same", accept: ["same"], run: 10594, dropped: 3224, droppedName: 'Victor González "Kasino"', kept: 3198 },
  { kind: "merged", name: "Iván Velázquez / Iván Velásquez", truth: "same", accept: ["same"], run: 10552, dropped: 2862, droppedName: "Iván Velázquez", kept: 21 },
  { kind: "pair", name: "Francisco Pacheco / Francisco Pacheco Jr.", truth: "different", accept: ["different"], a: 1709, b: 30892 },
  { kind: "pair", name: "Luis Arismendi / Luis Arismendi Jr.", truth: "different", accept: ["different"], a: 3845, b: 32331 },
  { kind: "mixed", name: "Francisco Pacheco juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 1709, join: [30892] },
  { kind: "mixed", name: "Luis Arismendi juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 3845, join: [32331] },
  { kind: "mixed", name: "Rafael «Gallo» Velásquez 8842 (+ grabaciones y diseño 2014)", truth: "mixed", accept: ["mixed"], person: 8842 },
  { kind: "mixed", name: "Luis Arismendi 1958–2004 (una persona)", truth: "single", accept: ["unknown"], person: 3845 },
  { kind: "mixed", name: "Aldemaro Romero (una persona)", truth: "single", accept: ["unknown"], person: 30 },
  { kind: "mixed", name: "Frank Quintero (una persona)", truth: "single", accept: ["unknown"], person: 3346 },
];
// Quinto conjunto fresco (FRESH=5, 2026-10-10): armado después de dar 17/20 y SIN tocar el verificador, para medir
// el código tal cual (con la lectura de páginas v4). Fuentes: revistaladosis y cusica (Boston Rex = Reynaldo Goitía,
// Tomates Fritos); diariolasamericas y senderosdeapure (Blanquito Man = José Andrés Blanco, King Changó); cusica y
// eluniversal (Mauricio «Maurimix» Arcas); salsabravave y lasalsavive (Calavén = Carlos Rafael Perdomo Yáñez, Los
// Calvos, Los Kenya); rockhechovenezuela y noesfm (Bélica = Annabella, La Hermandad, Guerrilla Seca); en.wikipedia
// y buenamusica (Yordano = Giordano Di Marzo Migani); sincopa y junglaboulevard.bandcamp (Magú Guzmán, guitarra de
// Jungla Boulevard); reverbnation y sincopa (Chofa Loero en Naxxo Piloto y Los Chevynovas); sincopa (Ivo = Pablo
// Augusto Díaz Barroso, Los Supersónicos); kontraste-latino y discogs (Felipe «Mandingo» Rengifo, Trabuco);
// yonathangavidia y guatacanights (Yonathan «Morocho» Gavidia, percusión con el Pollo Brito); es.wikipedia y
// talcualdigital (Álvaro Segura, guitarra de Zapato 3). Padre e hijo: discogs (Carlos Guerra Jr., trombón de
// Dimensión Latina, hijo de Carlos Guerra Alcalá); en.wikipedia y lanacion (Ricky Montaner = Ricardo Andrés Reglero,
// hijo de Ricardo Montaner, Mau y Ricky); quepasa (Heriberto Molina Jr., hijo del compositor de Guaco); otilca y hive
// (Adelso «Rolito» Paz; su hijo Adelso Jr. es maraquero: «Adelso Paz Jr.» y «Adelso Paz hijo» son él).
const fresh5: Case[] = [
  { kind: "merged", name: "Boston Rex / Reynaldo Goitía", truth: "same", accept: ["same"], run: 13285, dropped: 976, droppedName: "Boston Rex", kept: 774 },
  { kind: "merged", name: "Blanquito Man / José Andrés Blanco", truth: "same", accept: ["same"], run: 13285, dropped: 1418, droppedName: "Blanquito Man", kept: 3208 },
  { kind: "merged", name: "Maurimix / Mauricio Arcas", truth: "same", accept: ["same"], run: 13285, dropped: 229, droppedName: "Maurimix", kept: 367 },
  { kind: "merged", name: "Carlos Yánes / Calavén", truth: "same", accept: ["same"], run: 13285, dropped: 25443, droppedName: "Carlos Yánes", kept: 27867 },
  { kind: "merged", name: "Bélica / Annabella Almenar", truth: "same", accept: ["same"], run: 13285, dropped: 3725, droppedName: "Bélica", kept: 223 },
  { kind: "merged", name: "Yordano / Giordano Di Marzo", truth: "same", accept: ["same"], run: 13285, dropped: 4332, droppedName: "Yordano", kept: 1856 },
  { kind: "merged", name: "Magu / William «Magú» Guzmán", truth: "same", accept: ["same"], run: 13285, dropped: 5211, droppedName: "Magu", kept: 1848 },
  { kind: "merged", name: "Chofa / Alejandro «Chofa» Loero", truth: "same", accept: ["same"], run: 13285, dropped: 785, droppedName: "Chofa", kept: 437 },
  { kind: "merged", name: "Pablo Díaz / Ivo", truth: "same", accept: ["same"], run: 13285, dropped: 3802, droppedName: "Pablo Díaz", kept: 2869 },
  { kind: "merged", name: "Billo Frometa / Luis María «Billo» Frómeta", truth: "same", accept: ["same"], run: 13285, dropped: 20300, droppedName: "Billo Frometa", kept: 7779 },
  { kind: "merged", name: "Chelique / Chelique Sarabia", truth: "same", accept: ["same"], run: 13218, dropped: 31206, droppedName: "Chelique", kept: 57 },
  { kind: "merged", name: "Felipe Rengifo / Felipe «Mandingo» Rengifo", truth: "same", accept: ["same"], run: 13285, dropped: 20787, droppedName: "Felipe Rengifo", kept: 513 },
  { kind: "merged", name: "Yonathan Gavidia / Yonathan «Morocho» Gavidia", truth: "same", accept: ["same"], run: 13285, dropped: 21487, droppedName: "Yonathan Gavidia", kept: 8974 },
  { kind: "merged", name: "A. Segura / Álvaro Segura", truth: "same", accept: ["same"], run: 13285, dropped: 34568, droppedName: "A. Segura", kept: 490 },
  { kind: "pair", name: "Carlos Guerra / Carlos Guerra Jr. (padre e hijo)", truth: "different", accept: ["different"], a: 1282, b: 1047 },
  { kind: "pair", name: "Ricardo Montaner / Ricardo Montaner Jr. (Ricky)", truth: "different", accept: ["different"], a: 8405, b: 38122 },
  { kind: "pair", name: "Heriberto Molina / Heriberto Molina Jr.", truth: "different", accept: ["different"], a: 28154, b: 7767 },
  { kind: "pair", name: "Adelso Paz / Adelso Paz Jr.", truth: "different", accept: ["different"], a: 31155, b: 31156 },
  { kind: "pair", name: "Adelso Paz Jr. / Adelso Paz hijo (la misma persona)", truth: "same", accept: ["same"], a: 31156, b: 32344 },
  { kind: "mixed", name: "Carlos Guerra juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 1282, join: [1047] },
  { kind: "mixed", name: "Ricardo Montaner juntado (+ Ricky)", truth: "mixed", accept: ["mixed"], person: 8405, join: [38122] },
  { kind: "mixed", name: "Heriberto Molina juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 28154, join: [7767] },
  { kind: "mixed", name: "Adelso Paz juntado (padre + hijo)", truth: "mixed", accept: ["mixed"], person: 31155, join: [31156] },
  { kind: "mixed", name: "Yordano 1975–2023 (una persona)", truth: "single", accept: ["unknown"], person: 1856 },
  { kind: "mixed", name: "Billo Frómeta 1940–2014 (una persona)", truth: "single", accept: ["unknown"], person: 7779 },
  { kind: "mixed", name: "Ricardo Montaner (una persona)", truth: "single", accept: ["unknown"], person: 8405 },
  { kind: "mixed", name: "Reynaldo Goitía (una persona)", truth: "single", accept: ["unknown"], person: 774 },
  { kind: "mixed", name: "Álvaro Segura (una persona)", truth: "single", accept: ["unknown"], person: 490 },
  { kind: "mixed", name: "Chelique Sarabia 1958–2014 (una persona)", truth: "single", accept: ["unknown"], person: 57 },
  { kind: "mixed", name: "Oscar D'León 1972–2023 (una persona)", truth: "single", accept: ["unknown"], person: 21846 },
];
// Sexto conjunto fresco (FRESH=6, 2026-10-10): armado después de corregir lo que destapó el quinto (apellido
// compuesto: «Brother of Evio Di Marzo» separaba a Yordano), sin ajustar nada con él. Fuentes: es.wikipedia y
// meridiano (Colina = Oscar de Jesús Colina); noesfm y sincopa (Héctor «Tito» Fierro, Pixel, invitado de Zapato 3);
// en.wikipedia y biografiaszulianas (Henry Augustus Stephen Pierre); en.wikipedia «Serenata Guayanesa» (Mauricio
// Castro Rodríguez, fundador; Iván y César Pérez Rossi); cusica y ataquesonico (David «Chapis» Lasca, productor de
// Viniloversus y La Vida Bohème); analitica (Manuel «Manny» Diquez, 15 años con Franco De Vita); elestimulo y
// rockhechovenezuela (Erwin «Wincho» Schäfer, Sentimiento Muerto, Atkinson); es.wikipedia «Aditus» (Sandro
// Liberatoscioli, George Henríquez); buenamusica y sincopa (Leo Colina y Pipo Ramírez, Mermelada Bunch); paltoque
// (Gabriel «Pepo» Lamberti y su hermano Edgar, Andreazulado); lasemifusa y todosantos.bandcamp (Mariana «Nana»
// Cadavieco); es.wikipedia «Pedro Junco Jr.» (compositor de «Nosotros»: las dos fichas son él); en.wikipedia «Juan
// Vicente Torrealba» (sus temas; su hijo Juan Vicente Torrealba León, n. 1945); en.wikipedia «Yordano» (hermano de
// Evio Di Marzo, los dos en Sietecuero); talcualdigital (Álvaro Segura fundó Zapato 3 con su hermano Carlos).
const fresh6: Case[] = [
  { kind: "merged", name: "Colina / Oscar De Jesús Colina", truth: "same", accept: ["same"], run: 13285, dropped: 2567, droppedName: "Colina", kept: 2675 },
  { kind: "merged", name: "Héctor «Tito» Fierro / Tito Fierro", truth: "same", accept: ["same"], run: 10552, dropped: 299, droppedName: 'Héctor "Tito" Fierro', kept: 1556 },
  { kind: "merged", name: "Henry Augustus Stephen Pierre / Henry Augustus Stephen", truth: "same", accept: ["same"], run: 13285, dropped: 2716, droppedName: "Henry Augustus Stephen Pierre", kept: 1868 },
  { kind: "merged", name: "Mauricio Castro / Mauricio Castro Rodríguez", truth: "same", accept: ["same"], run: 13285, dropped: 25537, droppedName: "Mauricio Castro", kept: 914 },
  { kind: "merged", name: "Chapis Lasca / David «Chapis» Lasca", truth: "same", accept: ["same"], run: 10552, dropped: 250, droppedName: "Chapis Lasca", kept: 657 },
  { kind: "merged", name: "Manuel Diquez / Manuel «Manny» Diquez", truth: "same", accept: ["same"], run: 13285, dropped: 34728, droppedName: "Manuel Diquez", kept: 1669 },
  { kind: "merged", name: "Erwin «Wincho» Schäfer / Wincho Schäfer", truth: "same", accept: ["same"], run: 10552, dropped: 2662, droppedName: 'Erwin "Wincho" Schäfer', kept: 174 },
  { kind: "merged", name: "Liberatoscioli / Sandro Liberatoscioli", truth: "same", accept: ["same"], run: 4659, dropped: 9375, droppedName: "Liberatoscioli", kept: 40 },
  { kind: "merged", name: "Henríquez / George Henríquez", truth: "same", accept: ["same"], run: 4657, dropped: 7080, droppedName: "Henríquez", kept: 67 },
  { kind: "merged", name: "L. Colina / Leo Colina", truth: "same", accept: ["same"], run: 13285, dropped: 37699, droppedName: "L. Colina", kept: 741 },
  { kind: "merged", name: "Pepo Lamberti / Gabriel «Pepo» Lamberti", truth: "same", accept: ["same"], run: 10552, dropped: 1001, droppedName: "Pepo Lamberti", kept: 992 },
  { kind: "merged", name: "Mariana «Nana» Cadavieco / Nana Cadavieco", truth: "same", accept: ["same"], run: 10552, dropped: 1225, droppedName: 'Mariana "Nana" Cadavieco', kept: 3493 },
  { kind: "merged", name: "Jorge Ramírez «Pipo» / Pipo Ramírez", truth: "same", accept: ["same"], run: 10552, dropped: 2219, droppedName: 'Jorge Ramírez "Pipo"', kept: 740 },
  { kind: "pair", name: "Pedro Junco / Pedro Junco Jr. (el mismo compositor)", truth: "same", accept: ["same"], a: 29174, b: 20312 },
  { kind: "pair", name: "Juan V. Torrealba / Juan Vicente Torrealba (el mismo)", truth: "same", accept: ["same"], a: 21742, b: 4456 },
  { kind: "pair", name: "Juan V. Torrealba / Juan V. Torrealba Jr. (padre e hijo)", truth: "different", accept: ["different"], a: 21742, b: 31942 },
  { kind: "pair", name: "Evio Di Marzo / Giordano Di Marzo (hermanos)", truth: "different", accept: ["different"], a: 2359, b: 1856 },
  { kind: "pair", name: "Edgar Lamberti / Gabriel «Pepo» Lamberti (hermanos)", truth: "different", accept: ["different"], a: 996, b: 992 },
  { kind: "pair", name: "Carlos Segura / Álvaro Segura (hermanos)", truth: "different", accept: ["different"], a: 493, b: 490 },
  { kind: "mixed", name: "Yordano juntado (+ su hermano Evio)", truth: "mixed", accept: ["mixed"], person: 1856, join: [2359] },
  { kind: "mixed", name: "Pepo Lamberti juntado (+ su hermano Edgar)", truth: "mixed", accept: ["mixed"], person: 992, join: [996] },
  { kind: "mixed", name: "Álvaro Segura juntado (+ su hermano Carlos)", truth: "mixed", accept: ["mixed"], person: 490, join: [493] },
  { kind: "mixed", name: "Colina 1982–2019 (una persona)", truth: "single", accept: ["unknown"], person: 2675 },
  { kind: "mixed", name: "Henry Stephen 1964–2011 (una persona)", truth: "single", accept: ["unknown"], person: 1868 },
  { kind: "mixed", name: "Mauricio Castro Rodríguez (una persona)", truth: "single", accept: ["unknown"], person: 914 },
  { kind: "mixed", name: "Tito Fierro (una persona)", truth: "single", accept: ["unknown"], person: 1556 },
  { kind: "mixed", name: "Evio Di Marzo 1975–2013 (una persona)", truth: "single", accept: ["unknown"], person: 2359 },
  { kind: "mixed", name: "Manny Diquez (una persona)", truth: "single", accept: ["unknown"], person: 1669 },
  { kind: "mixed", name: "Carlos Segura (una persona)", truth: "single", accept: ["unknown"], person: 493 },
];
// Séptimo conjunto fresco (FRESH=7, 2026-10-10): armado después de corregir lo que destaparon el quinto y el sexto
// (hermanos con el mismo apellido, seudónimo junto a «hijo», variantes de Discogs), sin ajustar nada con él. Fuentes:
// en.wikipedia «Ilan Chester» (Ilan Czenstochowski Schaechter); diariolasamericas y en.wikipedia «King Changó»
// (Negrito Man = Luis Eduardo Blanco, hermano de José Andrés «Blanquito Man» Blanco); eluniverso y armando.info
// (KPU = Leandro Ciro Añez Grippa, productor de Canserbero); rockhechovenezuela «Billy Se Fue» (Jarzen Arcia «Jarz»,
// Neil Enet «Nilz»); rockhechovenezuela «God's New Version» (Andrés Morillo y Jesús «G-zaz» Romero); talentovenezolano
// (Alfredo Matheus Diez «Matheus10»); venciclopedia «La Misma Gente» (Pedro Vicente «PTT» Lizardo y su hermano Humberto
// Enrique Lizardo); en.wikipedia «Nella Rojas» (Marianella Rojas); cusica (Orlando «Mangan» Martínez, Viniloversus).
const fresh7: Case[] = [
  { kind: "merged", name: "Ilan Chéster / Ilan Czenstochouski Schechter", truth: "same", accept: ["same"], run: 13285, dropped: 30702, droppedName: "Ilan Chéster", kept: 544 },
  { kind: "merged", name: "Negrito Man / Luis Eduardo Blanco", truth: "same", accept: ["same"], run: 13285, dropped: 13241, droppedName: "Negrito Man", kept: 3217 },
  { kind: "merged", name: "Leandro Añez Grippa / KPU", truth: "same", accept: ["same"], run: 13285, dropped: 13008, droppedName: "Leandro Añez Grippa", kept: 2764 },
  { kind: "merged", name: "Jarz / Jarzen Arcia", truth: "same", accept: ["same"], run: 13285, dropped: 4926, droppedName: "Jarz", kept: 862 },
  { kind: "merged", name: "Neil Enet / Nilz", truth: "same", accept: ["same"], run: 13285, dropped: 860, droppedName: "Neil Enet", kept: 4927 },
  { kind: "merged", name: "G-Zaz / Jesús Romero", truth: "same", accept: ["same"], run: 13285, dropped: 34394, droppedName: "G-Zaz", kept: 5839 },
  { kind: "merged", name: "André / Andrés Morillo", truth: "same", accept: ["same"], run: 13285, dropped: 34393, droppedName: "André", kept: 5845 },
  { kind: "merged", name: "Matheus 10 / Alfredo Matheus Diez", truth: "same", accept: ["same"], run: 13285, dropped: 35413, droppedName: "Matheus 10", kept: 7101 },
  { kind: "merged", name: "PTT Lizardo / Pedro V. Lizardo", truth: "same", accept: ["same"], run: 10549, dropped: 4720, droppedName: "PTT Lizardo", kept: 1068 },
  { kind: "merged", name: "Nella / Marianella Rojas", truth: "same", accept: ["same"], run: 13285, dropped: 21016, droppedName: "Nella", kept: 17364 },
  { kind: "merged", name: "Orlando Martínez / Orlando «Mangan» Martínez", truth: "same", accept: ["same"], run: 13285, dropped: 36474, droppedName: "Orlando Martínez", kept: 3344 },
  { kind: "merged", name: "Humberto E. Lizardo «Ike» / Humberto E. Lizardo", truth: "same", accept: ["same"], run: 10549, dropped: 3618, droppedName: 'Humberto E. Lizardo "Ike"', kept: 3225 },
  { kind: "pair", name: "Pedro V. Lizardo / Humberto E. Lizardo (hermanos)", truth: "different", accept: ["different"], a: 1068, b: 3225 },
  { kind: "pair", name: "José Andrés Blanco / Luis Eduardo Blanco (hermanos)", truth: "different", accept: ["different"], a: 3208, b: 3217 },
  { kind: "pair", name: "Jesús «G-zaz» Romero / Andrés Morillo (God's New Version)", truth: "different", accept: ["different"], a: 5839, b: 5845 },
  { kind: "pair", name: "Jarzen Arcia / Nilz (Billy Se Fue)", truth: "different", accept: ["different"], a: 862, b: 4927 },
  { kind: "mixed", name: "PTT Lizardo juntado (+ su hermano Humberto)", truth: "mixed", accept: ["mixed"], person: 1068, join: [3225] },
  { kind: "mixed", name: "Blanquito Man juntado (+ su hermano Negrito Man)", truth: "mixed", accept: ["mixed"], person: 3208, join: [3217] },
  { kind: "mixed", name: "G-zaz juntado (+ Andrés Morillo)", truth: "mixed", accept: ["mixed"], person: 5839, join: [5845] },
  { kind: "mixed", name: "Ilan Chester 1971–2015 (una persona)", truth: "single", accept: ["unknown"], person: 544 },
  { kind: "mixed", name: "Nella (una persona)", truth: "single", accept: ["unknown"], person: 17364 },
  { kind: "mixed", name: "KPU (una persona)", truth: "single", accept: ["unknown"], person: 2764 },
  { kind: "mixed", name: "Matheus10 (una persona)", truth: "single", accept: ["unknown"], person: 7101 },
  { kind: "mixed", name: "PTT Lizardo 1970–2016 (una persona)", truth: "single", accept: ["unknown"], person: 1068 },
  { kind: "mixed", name: "Mangan Martínez (una persona)", truth: "single", accept: ["unknown"], person: 3344 },
  { kind: "mixed", name: "Negrito Man (una persona)", truth: "single", accept: ["unknown"], person: 3217 },
];
// Fresco 8 (2026-10-10), armado después de cerrar las reglas del fresco 7 y sin ajustar nada con él. Fuentes:
// vice.com «Mi obra antes que mi nombre: Lou Fresco» y en.wikipedia «Lil Supa» (Marlon Morales = Lou Fresco);
// last.fm «luiser» y Deezer (Luis Ernesto Serrano «Luiser», «Morfeo»); elnacional «Murió el cantante Al Zeppy» (Alberto
// Lewis); keeprockingvenezuela y oidossucios «Subsonus» (Carlos «Fresa» Mata); sincopa «La Ruta» y Big Landin (Guillermo
// «Willy» Noya, trombón); en.wikipedia «Tweety González» (mezcló «El amor ya no existe» y «Casa 4» de Famasloop);
// vladbone.com (Vladimir Peña, trombón de Fauna Crepuscular y Los Amigos Invisibles); uncobanda.bandcamp y crestametalica
// (Carlos «Cuso» González, UNCO). Padre e hijo: rumberos.net «Morocotopo» (William Sigismondi Jr., hijo del pianista).
// Misma persona con «Jr.»: imdb y encyclopedia.com (Emilio Estefan Jr., el productor; no hay otro Emilio Estefan músico).
// Mezcladas por fusiones equivocadas de la run 13285: metal-archives «Hiena» (Ezlen Ramos, batería, 2009–2015) frente a
// es.wikipedia «José Antonio Ramos (músico)» (timplista canario, 1969–2008); houstonsymphony y drummerszone (Luisito
// Quintero, percusionista, 1967) frente a desdeelghetto «PapaShanty Saund System» (Luis Quintero «Bosta's Brain», voz,
// de La Corte); es.wikipedia «Roberto Antonio» («25 años», 2010, con Chino & Nacho) y «Nacho (cantante)» (Miguel
// Ignacio Mendoza) frente al bajista de Ricochet. Una sola persona: es.wikipedia (Gustavo Aguado, Guaco; Renato
// Capriles, Los Melódicos; Trino Mora; Italo Pizzolante); fullersound.com (Mike Fuller); sincopa (Gonzalo Teppa,
// Alexander Livinalli).
const fresh8: Case[] = [
  { kind: "merged", name: "Lou Fresco / Marlon Morales", truth: "same", accept: ["same"], run: 13285, dropped: 2834, droppedName: "Lou Fresco", kept: 2832 },
  { kind: "merged", name: "Luiser / Luis E. Serrano", truth: "same", accept: ["same"], run: 13285, dropped: 27442, droppedName: "Luiser", kept: 6537 },
  { kind: "merged", name: "Al Zeppy / Alberto Lewis", truth: "same", accept: ["same"], run: 13285, dropped: 7192, droppedName: "Al Zeppy", kept: 7178 },
  { kind: "merged", name: "Fresa / Carlos «Fresa» Mata", truth: "same", accept: ["same"], run: 13285, dropped: 6566, droppedName: "Fresa", kept: 1008 },
  { kind: "merged", name: "Guillermo Noya / Willy Noya", truth: "same", accept: ["same"], run: 10552, dropped: 6109, droppedName: "Guillermo Noya", kept: 389 },
  { kind: "merged", name: "Fabián «Tweety» González / Tweety González", truth: "same", accept: ["same"], run: 10552, dropped: 1432, droppedName: 'Fabián "Tweety" González', kept: 451 },
  { kind: "merged", name: "Vladimir «Arfavor» Peña / Vladimir Peña", truth: "same", accept: ["same"], run: 10448, dropped: 2909, droppedName: 'Vladimir "Arfavor" Peña', kept: 735 },
  { kind: "merged", name: "Cuso / Carlos «Cuso» González", truth: "same", accept: ["same"], run: 13285, dropped: 1391, droppedName: "Cuso", kept: 6817 },
  { kind: "pair", name: "William Sigismondi / William Sigismondi Jr. (padre e hijo)", truth: "different", accept: ["different"], a: 3881, b: 21173 },
  { kind: "pair", name: "Emilio Estefan / Emilio Estefan Jr. (la misma persona)", truth: "same", accept: ["same"], a: 38411, b: 8073 },
  { kind: "mixed", name: "Ezlen Ramos 5900: + timple de José Antonio Ramos", truth: "mixed", accept: ["mixed"], person: 5900 },
  { kind: "mixed", name: "Luisito Quintero 1701: + Luis Quintero «Bosta's Brain»", truth: "mixed", accept: ["mixed"], person: 1701 },
  { kind: "mixed", name: "Ignacio Pérez 3343: + Nacho de Chino & Nacho", truth: "mixed", accept: ["mixed"], person: 3343 },
  { kind: "mixed", name: "Gustavo Aguado (una persona)", truth: "single", accept: ["unknown"], person: 339 },
  { kind: "mixed", name: "Renato Capriles (una persona)", truth: "single", accept: ["unknown"], person: 27213 },
  { kind: "mixed", name: "Trino Mora (una persona)", truth: "single", accept: ["unknown"], person: 8775 },
  // Se armó como «una persona», pero la ficha tiene voz y guitarras de Americania de 2009–2026 (el compositor murió
  // en 2011): son de su pariente Ítalo Aquiles Pizzolante (es.wikipedia «Italo Pizzolante»). El verificador lo vio en
  // la primera corrida; la etiqueta se corrigió después, con esa fuente y los créditos a la vista.
  { kind: "mixed", name: "Italo Pizzolante 1260: + Ítalo Aquiles Pizzolante (Americania)", truth: "mixed", accept: ["mixed"], person: 1260 },
  { kind: "mixed", name: "Mike Fuller (una persona)", truth: "single", accept: ["unknown"], person: 2409 },
  { kind: "mixed", name: "Gonzalo Teppa (una persona)", truth: "single", accept: ["unknown"], person: 3605 },
  { kind: "mixed", name: "Alexander Livinalli (una persona)", truth: "single", accept: ["unknown"], person: 3517 },
];
// Fresco 9 (2026-10-10), armado después de las correcciones que dejó el fresco 8 y sin ajustar nada con él. Fuentes:
// herencialatina y asocosalsa74 «Federico y su Combo Latino» (Tomás Martínez «El Bobby», cantante fundador);
// venciclopedia «José Antonio Rojas» e Instagram @rojitasdimension (Rojitas, trombón de Federico y de Dimensión Latina);
// indierocks y efectococuyo (Leonardo «Kmaron» Jaramillo, guitarrista de Okills). Mezcladas por fusiones equivocadas
// de la run 13285: rockhechovenezuela «Almas» (Rubén «El Enano» Castro, voz y guitarra, Maracay 2008) frente a
// en.wikipedia «Caramelos de Cianuro» (Miguel Ángel «El Enano» González); sincopa «Huáscar Barradas & Maracaibo –
// Encuentros» (los raps son de Pipo Ramírez) frente a Francisco González (Nauta, Novarmada, nacido en 1988). Una sola
// persona: efemeridesynoticiasmusicales y rockhechovenezuela (Francisco Belisario, Los Impala); venciclopedia
// «José Antonio Rojas»; solarlatinclub «Raúl Agraz – Between Brothers» (trompetista); es.wikipedia «Témpano»
// (Iker Gastaminza, teclados).
const fresh9: Case[] = [
  { kind: "merged", name: "El Bobby / Tomás Martínez", truth: "same", accept: ["same"], run: 13285, dropped: 27879, droppedName: "El Bobby", kept: 21246 },
  { kind: "merged", name: "Rojitas / José Antonio Rojas", truth: "same", accept: ["same"], run: 13285, dropped: 27529, droppedName: "Rojitas", kept: 15503 },
  { kind: "merged", name: "Leonardo «El Kmaron» Jaramillo / Leonardo Jaramillo", truth: "same", accept: ["same"], run: 13285, dropped: 35367, droppedName: 'Leonardo "El Kmaron" Jaramillo', kept: 1278 },
  { kind: "mixed", name: "Miguel Gonzáles 2704: + Rubén «El Enano» Castro (Almas)", truth: "mixed", accept: ["mixed"], person: 2704 },
  { kind: "mixed", name: "Francisco Gonzalez 9280: + raps de Pipo Ramírez", truth: "mixed", accept: ["mixed"], person: 9280 },
  { kind: "mixed", name: "Francisco Belisario (una persona)", truth: "single", accept: ["unknown"], person: 977 },
  { kind: "mixed", name: "José Antonio Rojas (una persona)", truth: "single", accept: ["unknown"], person: 15503 },
  { kind: "mixed", name: "Raúl Agraz (una persona)", truth: "single", accept: ["unknown"], person: 2768 },
  { kind: "mixed", name: "Iker Gastaminza (una persona)", truth: "single", accept: ["unknown"], person: 661 },
];
// Fresco 10 (2026-10-10), cerrado antes de medir la v6; todo confirmado en la web:
// Frank Belisario = Francisco «Frank» Belisario (elestimulo.com, «Años 60…»; antologiavenezuela «Rudy Márquez/Frank Belisario»).
// Angie Machado = Ángel Vicente Machado, trompetista con Oscar D'León (es.salsagoogle.com).
// Francisco Tedesco, batería de Carlos Jaeger («Claroscuro», sincopa.com) = Franchesco «Chicho» Tedesco, batería (es.wikipedia Rolling Band).
// Sofía Pulido = Sofía Pulido «La Nena», coros (antologiavenezuela, etiqueta Reggae).
// César Somoza, voz y fundador de Resistencia (lobotoradio.com, meridiano.net).
// Gerardo Ubieda, baterista de Témpano (gerardoubieda.com); sus créditos son todos suyos.
const fresh10: Case[] = [
  { kind: "merged", name: "Frank Belisario / Francisco Belisario", truth: "same", accept: ["same"], run: 13285, dropped: 39146, droppedName: "Frank Belisario", kept: 977 },
  { kind: "merged", name: "Angie Machado / Angel Machado", truth: "same", accept: ["same"], run: 13285, dropped: 30192, droppedName: "Angie Machado", kept: 1703 },
  { kind: "merged", name: "Francisco Tedesco / Francisco «Chicho» Tedesco", truth: "same", accept: ["same"], run: 13285, dropped: 27438, droppedName: "Francisco Tedesco", kept: 3443 },
  { kind: "merged", name: "Sofía Pulido / Sofía «La Nena» Pulido", truth: "same", accept: ["same"], run: 13285, dropped: 29392, droppedName: "Sofía Pulido", kept: 5990 },
  { kind: "merged", name: "César Somoza / César Alberto Somoza", truth: "same", accept: ["same"], run: 13285, dropped: 37936, droppedName: "César Somoza", kept: 2943 },
  { kind: "mixed", name: "Gerardo Ubieda (una persona)", truth: "single", accept: ["unknown"], person: 923 },
];
// Fresco 11 (2026-10-11), cerrado antes de medir la v8 (forma compartida, listas, apodo con letras sueltas):
// René Toledo = René L. Toledo, guitarrista cubano (audiokat.com: «René L. Toledo nació en La Habana… René Luis Toledo»).
// Carlos Landaeta = Carlos Emilio Landaeta «Pan con Queso» (sincopa.com Sonero Clásico del Caribe: «Bongos, Congas,
// Maracas: Carlos Emilio Landaeta "Pan con Queso" (1976-1991)»; telesurtv.net).
// Pedro Montañez = Pedro José Montañez, fotógrafo de Grupo Vera (sincopa.com «Photo: Pedro José Montañez»).
const fresh11: Case[] = [
  { kind: "pair", name: "René Toledo / René L. Toledo (el mismo guitarrista)", truth: "same", accept: ["same"], a: 8058, b: 25948 },
  { kind: "pair", name: "Carlos Landaeta / Carlos Emilio Landaeta («Pan con Queso»)", truth: "same", accept: ["same"], a: 27398, b: 27340 },
  { kind: "pair", name: "Pedro Montañez / Pedro José Montañez (fotógrafo de Grupo Vera)", truth: "same", accept: ["same"], a: 31640, b: 31627 },
  { kind: "mixed", name: "René L. Toledo (una persona)", truth: "single", accept: ["unknown"], person: 25948 },
  { kind: "mixed", name: "Carlos Emilio Landaeta (una persona)", truth: "single", accept: ["unknown"], person: 27340 },
];
// Fresco 12 (2026-10-11), cerrado antes de medir la v11; nombre artístico frente a nombre real, confirmado en la web:
// Nano Grand = Octavio Ramón Palacios (nanogrand.blogspot.com: «lo bautizaron con el nombre de Octavio Ramón Palacios…»).
// Joseph Sun = José Montilva (Cinema Sun 2009, créditos: «Drums…: José Montilva "Joseph Sun"»).
// Juan Camacho = Johnny Quirós («Juan Camacho Camacho es el verdadero nombre de Johnny Quiros», Costa Rica, 1923).
// Recard = Remo Caremartori (hippitoysuschatarritas, Henry Stephen 1974: «Remo Caremartori a.k.a. Recard»).
const fresh12: Case[] = [
  { kind: "merged", name: "Nano Grand / Octavio Palacios", truth: "same", accept: ["same"], run: 13285, dropped: 22217, droppedName: "Nano Grand", kept: 21251 },
  { kind: "merged", name: "Joseph Sun / José Montilva", truth: "same", accept: ["same"], run: 13285, dropped: 5185, droppedName: "Joseph Sun", kept: 2208 },
  { kind: "merged", name: "Juan Camacho / Johnny Quiros", truth: "same", accept: ["same"], run: 10552, dropped: 2717, droppedName: "Juan Camacho", kept: 10051 },
  { kind: "merged", name: "Remo Caremartori / Recard", truth: "same", accept: ["same"], run: 13285, dropped: 47, droppedName: "Remo Caremartori", kept: 11032 },
];
const isHoldout = process.env["HOLDOUT"] === "1";
const isFresh12 = process.env["FRESH"] === "12";
const isFresh11 = process.env["FRESH"] === "11";
const isFresh10 = process.env["FRESH"] === "10";
const isFresh9 = process.env["FRESH"] === "9";
const isFresh8 = process.env["FRESH"] === "8";
const isFresh7 = process.env["FRESH"] === "7";
const isFresh6 = process.env["FRESH"] === "6";
const isFresh5 = process.env["FRESH"] === "5";
const isFresh4 = process.env["FRESH"] === "4";
const isFresh = process.env["FRESH"] === "1";
const isFresh2 = process.env["FRESH"] === "2";
const isFresh3 = process.env["FRESH"] === "3";

interface CreditRow { kind: string; id: string; name: string; album: string | null; year: number | null; role: string; }

async function credits(personId: number): Promise<CreditRow[]> {
  return (await getPool().query<CreditRow>(`
    SELECT 'album' AS kind, c.id::text, ar.name, a.title AS album, a.release_year AS year, c.role FROM public.album_credits c
      JOIN public.albums a ON a.id=c.album_id JOIN public.artists ar ON ar.id=a.artist_id WHERE c.person_id=$1
    UNION ALL SELECT 'track', c.id::text, ar.name, a.title, a.release_year, c.role FROM public.track_credits c
      JOIN public.tracks t ON t.id=c.track_id JOIN public.albums a ON a.id=t.album_id JOIN public.artists ar ON ar.id=a.artist_id WHERE c.person_id=$1
    UNION ALL SELECT 'member', m.id::text, ar.name, NULL, m.from_year, 'integrante: ' || m.role FROM public.artist_members m
      JOIN public.artists ar ON ar.id=m.artist_id WHERE m.person_id=$1`, [personId])).rows;
}

/** Filas que la fusión pasó de la ficha descartada a la conservada, según el diario. */
async function movedRows(run: number, dropped: number): Promise<Set<string>> {
  const rows = (await getPool().query<{ kind: string; id: string }>(`
    SELECT CASE table_name WHEN 'public.album_credits' THEN 'album' WHEN 'public.track_credits' THEN 'track' ELSE 'member' END AS kind,
           row_pk->>'id' AS id
      FROM ingest.change_journal
     WHERE run_id=$1 AND table_name IN ('public.album_credits','public.track_credits','public.artist_members')
       AND old_data->>'person_id'=$2`, [run, String(dropped)])).rows;
  return new Set(rows.map((row) => `${row.kind}:${row.id}`));
}

/** Un renglón por disco con sus roles unidos, como personContext. */
function projects(rows: CreditRow[]): PersonContext["projects"] {
  const byAlbum = new Map<string, { name: string; album: string | null; year: number | null; roles: Set<string> }>();
  for (const row of rows) {
    const key = `${row.name}|${row.album}|${row.year}`;
    const entry = byAlbum.get(key) ?? { name: row.name, album: row.album, year: row.year, roles: new Set<string>() };
    entry.roles.add(row.role);
    byAlbum.set(key, entry);
  }
  return pickProjects([...byAlbum.values()].map(({ roles, ...rest }) => ({ ...rest, role: [...roles].join(", ") }))
    .sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999)), "");
}

async function person(id: number): Promise<{ name: string; birthDate: string | null; deathDate: string | null }> {
  const row = (await getPool().query<{ name: string; birth_date: string | null; death_date: string | null }>(
    "SELECT name, birth_date::text, death_date::text FROM public.persons WHERE id=$1", [id])).rows[0];
  if (!row) throw new Error(`Persona ${id} no encontrada`);
  return { name: row.name, birthDate: row.birth_date, deathDate: row.death_date };
}

/** Las dos fichas tal como estaban antes de la fusión (sin fuentes: los claims ya apuntan a la conservada). */
async function reconstruct(item: MergedCase): Promise<[PersonContext, PersonContext]> {
  const moved = await movedRows(item.run, item.dropped);
  const all = await credits(item.kept);
  const keptPerson = await person(item.kept);
  const droppedRows = all.filter((row) => moved.has(`${row.kind}:${row.id}`));
  const keptRows = all.filter((row) => !moved.has(`${row.kind}:${row.id}`));
  if (!droppedRows.length) throw new Error(`El diario de la run ${item.run} no devolvió créditos de ${item.dropped}`);
  return [
    { id: item.dropped, name: item.droppedName, birthDate: null, deathDate: null, projects: projects(droppedRows), sourceUrls: [] },
    { id: item.kept, ...keptPerson, projects: projects(keptRows), sourceUrls: [] },
  ];
}

interface Row { name: string; kind: Case["kind"]; truth: Truth; accept: Verdict[]; verdict: Verdict | "error"; correct: boolean;
  citations: number; sources: number; seconds: number; aiRunId?: number | null; rationale?: string; evidence?: unknown; sourceUrls?: string[]; error?: string; }

const rows: Row[] = [];
const only = process.argv.slice(2);
try {
  for (const item of isFresh12 ? fresh12 : isFresh11 ? fresh11 : isFresh10 ? fresh10 : isFresh9 ? fresh9 : isFresh8 ? fresh8 : isFresh7 ? fresh7 : isFresh6 ? fresh6 : isFresh5 ? fresh5 : isFresh4 ? fresh4 : isFresh3 ? fresh3 : isFresh2 ? fresh2 : isFresh ? fresh : isHoldout ? holdout : cases) {
    if (only.length && !only.some((needle) => item.name.toLowerCase().includes(needle.toLowerCase()))) continue;
    const started = Date.now();
    const base = { name: item.name, kind: item.kind, truth: item.truth, accept: item.accept };
    try {
      let verdict: Verdict; let evidence: Array<{ url: string; quote: string; supports: string }>; let rationale: string; let urls: string[]; let aiRunId: number | null;
      if (item.kind === "mixed") {
        let context = await personContext(item.person);
        if (item.join?.length) {
          // Ficha reconstruida: sin id real, para que las reglas de épocas no miren la ficha ya separada.
          const parts = await Promise.all(item.join.map((id) => personContext(id)));
          // La fecha de nacimiento viaja con la ficha que la tenía (la de Metal Archives, en Alfredo Gil).
          context = { ...context, id: -item.person, birthDate: context.birthDate ?? parts.find((part) => part.birthDate)?.birthDate ?? null,
            deathDate: context.deathDate ?? parts.find((part) => part.deathDate)?.deathDate ?? null,
            projects: pickProjects([...context.projects, ...parts.flatMap((part) => part.projects)].sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999)), context.name),
            // Fuentes de las partes intercaladas, como las tendría la ficha real (personContext da hasta 12).
            sourceUrls: [...new Set(Array.from({ length: 12 }, (_, index) => [context, ...parts].map((part) => part.sourceUrls[index]))
              .flat().filter((url): url is string => Boolean(url)))].slice(0, 12) };
        }
        const result = await investigateMixedContext(context);
        verdict = result.validated.verdict; evidence = result.validated.evidence; rationale = result.validated.rationale;
        urls = result.pages.map((page) => page.url); aiRunId = result.aiRunId;
      } else {
        const result = item.kind === "pair"
          ? await investigateKnownPersonPair(item.a, item.b)
          : await investigatePersonContexts(...await reconstruct(item));
        verdict = result.validated.verdict; evidence = result.validated.evidence; rationale = result.validated.rationale;
        urls = result.pages.map((page) => page.url); aiRunId = result.aiRunId;
      }
      rows.push({ ...base, verdict, correct: item.accept.includes(verdict), citations: evidence.length, sources: urls.length,
        seconds: Math.round((Date.now() - started) / 1000), aiRunId, rationale, evidence, sourceUrls: urls });
    } catch (error) {
      if (only.length) console.error(error);
      rows.push({ ...base, verdict: "error", correct: false, citations: 0, sources: 0, seconds: Math.round((Date.now() - started) / 1000),
        error: error instanceof Error ? error.message : String(error) });
    }
    const last = rows.at(-1)!;
    console.log(`${last.correct ? "✓" : "✗"} ${last.name}: ${last.verdict} (esperado ${last.accept.join("|")}, ${last.citations} citas, ${last.sources} páginas, ${last.seconds}s)`);
    // Con filtro (depuración de un caso) se muestra también el porqué y las páginas.
    if (only.length) console.log(`   ${last.rationale ?? last.error}\n   ${(last.sourceUrls ?? []).join("\n   ")}`);
  }
  const of = (truth: Truth) => rows.filter((row) => row.truth === truth);
  const hit = (list: Row[]) => list.filter((row) => row.correct).length;
  const counts = {
    total: rows.length, correct: hit(rows), errors: rows.filter((row) => row.verdict === "error").length,
    same: `${hit(of("same"))}/${of("same").length}`, different: `${hit(of("different"))}/${of("different").length}`,
    mixed: `${hit(of("mixed"))}/${of("mixed").length}`, single: `${hit(of("single"))}/${of("single").length}`,
    doubtful: `${hit(of("doubtful"))}/${of("doubtful").length}`,
    // Errores graves: los que harían daño si se aplicaran.
    falseMerges: rows.filter((row) => row.truth !== "same" && row.verdict === "same").length,
    falseSeparations: rows.filter((row) => row.truth === "same" && row.verdict === "different").length,
    falseMixed: rows.filter((row) => row.truth === "single" && row.verdict === "mixed").length,
  };
  // Listo = ningún error grave, y acierta la mayoría en cada tipo de caso.
  const ratio = (list: Row[]) => list.length ? hit(list) / list.length : 1;
  const ready = counts.errors === 0 && counts.falseMerges === 0 && counts.falseSeparations === 0 && counts.falseMixed === 0
    && ratio(of("same")) >= 0.7 && ratio(of("different")) >= 0.6 && ratio(of("mixed")) >= 0.5 && ratio(of("single")) === 1;
  const report = { date: new Date().toISOString(), criteria: "0 fusiones falsas, 0 separaciones falsas, 0 mezclas falsas, 0 errores; ≥70 % misma persona, ≥60 % distintas, ≥50 % mezcladas, 100 % fichas de una persona", counts, ready, cases: rows };
  const output = `reports/person-web-verification-${isFresh12 ? "fresca-12" : isFresh11 ? "fresca-11" : isFresh10 ? "fresca-10" : isFresh9 ? "fresca-9" : isFresh8 ? "fresca-8" : isFresh7 ? "fresca-7" : isFresh6 ? "fresca-6" : isFresh5 ? "fresca-5" : isFresh4 ? "fresca-4" : isFresh3 ? "fresca-3" : isFresh2 ? "fresca-2" : isFresh ? "fresca" : isHoldout ? "validacion" : "dificil"}-${new Date().toISOString().slice(0, 10)}.json`;
  if (!only.length) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(counts, { ready });
} finally { await closeDb(); }
