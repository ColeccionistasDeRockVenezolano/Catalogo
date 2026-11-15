"""Significado en español de los descriptores de RYM que el glosario oficial deja sin texto.

RYM no define 109 de sus 505 descriptores (las 28 hojas de «mood» entre ellos; glosario corregido
en data/research/emociones-descriptores-2026-11-12/glosario-corregido.json). Estas definiciones
son de Claude (2026-11-12), redactadas a partir de, por orden de peso:
  1. la jerarquía oficial de RYM (p. ej. melancholic, lonely, depressive y sombre son hijos de «sad»;
     soothing de «mellow»; meditative de «calm»; triumphant de «uplifting»; manic de «energetic»);
  2. cómo usa la comunidad cada término en las 4.913 fichas con descriptores (con qué otros
     descriptores y géneros aparece más de lo esperado);
  3. el sentido léxico (Wiktionary) y, para técnicas, Wikipedia;
  4. las búsquedas comparativas «X vs Y vs Z» entre vecinos;
  5. el foro de RYM (rym.fm, leído con la sesión de Brian): hilos de la cola de descriptores y de
     diferencias entre ellos (data/research/emociones-foro-rym-2026-11-12/foro-rym.json).
La evidencia de cada uno queda en docs/unified-search/emociones/rym-descriptores.json.

SIG[descriptor] = (definición, distinción frente a sus vecinos o None)
"""

SIG = {
    # --- mood: emociones -------------------------------------------------------------
    "aggressive": ("Música que ataca: golpe, volumen y voz agresivos que transmiten hostilidad o combate.",
                   "Rabia puesta en acción (foro 2016: «acted out anger»): es la manera de sonar; angry es la emoción."),
    "angry": ("Música que expresa enojo o rabia, en la letra, la voz o la intensidad.",
              "Emoción, no estilo: un disco puede ser aggressive sin estar enojado y al revés."),
    "anxious": ("Transmite nerviosismo, inquietud o tensión ante algo que amenaza; deja al oyente intranquilo.",
                "Sube la tensión del oyente, como la música de suspenso; siempre negativa (suspenseful puede no serlo). Scary es más intensa."),
    "bittersweet": ("Mezcla de dolor y dulzura en la misma pieza: alegría teñida de tristeza o tristeza con consuelo.",
                    "Valencia mixta; frente a melancholic, conserva un lado luminoso."),
    "calm": ("Tranquila y sin sobresaltos, libre de tensión o de ruido.",
             "Calm es ausencia de agitación; el foro la ve muy próxima a mellow. Un himno emotivo puede ser meditative sin ser calm."),
    "depressive": ("Hija de «sad» en RYM: tristeza profunda y desesperanzada, abatimiento persistente; "
                   "en la comunidad va con lonely, alienation, suicide y DSBM.",
                   "Desolación grave y crónica (letargo, embotamiento, desesperanza); el foro la ve como «sad, but more». No es un diagnóstico."),
    "disturbing": ("Perturba e inquieta: incomoda al oyente por su sonido o su contenido.",
                   "Choca y espanta (foro: «shocking and appalling»); ominous es amenaza latente; scary es miedo intenso."),
    "energetic": ("Llena de energía y vigor: rápida, intensa, que empuja hacia adelante.",
                  "Energía sin signo emocional (un dance-pop simple); manic es su desborde caótico."),
    "happy": ("Transmite alegría y bienestar.",
              "Alegría exultante (Blame It on the Boogie); uplifting está hecho para motivar o elevar; triumphant celebra una victoria."),
    "lethargic": ("Lenta, pesada y adormecida, como sin fuerzas; en la comunidad va con lo-fi, surreal y cryptic.",
                  "Es baja energía del sonido (la comunidad la usa para lo lento, a falta de «slow»; también slacker rock), no apatía de la letra (apathetic)."),
    "longing": ("Anhelo: deseo de algo o alguien ausente o perdido.",
                "Mira hacia lo que falta; puede ser dolorosa o esperanzada. Nostalgia mira al pasado; lonely es el aislamiento."),
    "manic": ("Hija de «energetic»: energía frenética, desbordada y caótica; en la comunidad va con chaotic, noisy y grindcore.",
              "Desborde caótico, no simple energía: un amasijo glitch con gritos puede ser manic sin ser energetic. No implica alegría."),
    "melancholic": ("Hija de «sad»: tristeza honda y reflexiva, que se recrea en lo perdido.",
                    "Tristeza pensativa (foro: «pensiveness»); más contemplativa que sad, menos desesperanzada que depressive."),
    "mellow": ("Suave, relajada y sin aristas, de tempo y dinámica moderados.",
               "Ánimo relajado y suave (soft es solo sonido); un estándar de jazz puede ser mellow sin ser soothing."),
    "passionate": ("Expresa sentimiento intenso y entrega, ya sea amor, dolor o convicción.",
                   "Intensidad emocional; no es necesariamente romántica ni sensual."),
    "playful": ("Juguetona, traviesa y ligera; con humor o desenfado.",
                "Actitud juguetona de la obra (no ánimo provocado); frente a quirky, diversión sin extrañeza."),
    "quirky": ("Excéntrica y peculiar, con rarezas simpáticas o torpes a propósito.",
               "Lo raro con gracia (el foro propone llamarlo whimsical); es actitud de la obra más que ánimo provocado; no equivale a experimental."),
    "romantic": ("Expresa afecto amoroso, ternura e idealización del amor.",
                 "Romantic es afecto e idealización; sensual es placer de los sentidos; sexual es tema."),
    "sad": ("Transmite tristeza; su descripción corta oficial menciona el duelo (según el foro). Es la categoría madre de melancholic, lonely, depressive y sombre.",
            "La forma básica de la tristeza; la comunidad usa más melancholic, a menudo como sinónimo."),
    "scary": ("Da miedo o inquieta como el terror.", "Frente a fear (tema de la letra), scary es el efecto en el oyente."),
    "sensual": ("Invita al placer de los sentidos: cálida, envolvente, sugerente.",
                "Carácter de la música (el slow jam a lo Marvin Gaye); se transmite sin letra. No acredita actividad íntima; sexual es el tema de la letra."),
    "sentimental": ("Apela a la emoción tierna, a veces en exceso; cariño, recuerdo y ternura.",
                    "Ternura, nostalgia y dulzura (lo opuesto a serious); puede ser romántica o de duelo."),
    "sombre": ("Hija de «sad»: grave, sombría y solemne, de tono oscuro; en la comunidad va con dark, ominous y nocturnal.",
               "Gravedad oscura del tono, no necesariamente tristeza (una canción lenta y sensual puede ser sombre sin ser melancholic); muy cerca de funereal."),
    "lonely": ("Hija de «sad»: transmite soledad y aislamiento.", "Exige soledad o aislamiento: cantar sobre una injusticia es sad, no lonely."),
    "meditative": ("Hija de «calm»: invita a la contemplación y a la concentración; a menudo repetitiva o hipnótica.",
                   "Calma que absorbe la atención (Spirit of Eden, Ambient 2), no solo suavidad; no es para dormir."),
    "soothing": ("Hija de «mellow»: calma que consuela y alivia.", "Calm es estado; soothing es efecto de alivio y consuelo, que puede darse incluso con un drone fuerte."),
    "triumphant": ("Hija de «uplifting»: celebra una victoria o un logro; épica y exultante.",
                   "Celebratoria, jubilosa y orgullosa (marchas triunfales, We Are the Champions; crescendos, fanfarria); más grandiosa que happy."),
    "uplifting": ("Levanta el ánimo y da esperanza.", "Motivacional o espiritual, hecho para elevar o iluminar; no es simple alegría."),

    # --- tone (actitud de la letra) --------------------------------------------------
    "altruistic": ("Letra de actitud desinteresada, centrada en el bien de los demás.", None),
    "compassionate": ("Letra que muestra compasión o empatía por el sufrimiento ajeno.", None),
    "cynical": ("Letra que desconfía de los motivos ajenos y presume egoísmo o hipocresía.",
                "Frente a pessimistic: cynical apunta a los motivos de la gente y la sociedad; hay música pesimista no cínica y viceversa."),
    "sassy": ("Actitud descarada, insolente y segura de sí, a menudo ante la autoridad.", None),

    # --- atmosphere --------------------------------------------------------------------
    "beach": ("Evoca la playa: sol, arena y costa.", None),
    "desolate": ("Evoca paisajes vacíos, yermos y sin vida; desamparo.", None),
    "evening": ("Evoca el atardecer y la noche temprana.", None),
    "morning": ("Evoca la mañana y el despertar del día.", None),

    # --- estilo / técnica / voz / letra ----------------------------------------------------
    "four on the floor": ("Bombo en cada tiempo de un compás de 4/4, base de la música disco y electrónica de baile.", None),
    "growling": ("Gruñido gutural (death growl) de las voces extremas.", None),
    "humming": ("Tarareo con la boca cerrada.", None),
    "interpolation": ("Recrea una melodía o letra ajena en una composición nueva, sin usar la grabación original (a diferencia del sample).", None),
    "mixed meter": ("Cambios frecuentes de compás dentro de la pieza.", None),
    "triple meter": ("Compás ternario: tres pulsos por compás (3/4, 3/8, 9/8).", None),
    "pig squealing": ("Chillido agudo y porcino de las voces extremas (deathcore, slam).", None),
    "posse cut": ("Tema de hip hop con versos sucesivos de cuatro o más raperos.", None),
    "raspy vocals": ("Voz ronca y rasposa.", None),
    "shrieking": ("Alaridos agudos y estridentes.", None),
    "skronky": ("Hija de «dissonant»: sonido crudo y discordante, sobre todo de guitarra o vientos (skronk).", None),
    "stomping": ("Hija de «rhythmic»: ritmo pesado y machacón, de pisotón.", None),
    "stuttering vocals": ("Voz que repite o tartamudea sílabas como recurso.", None),
    "tunnel screaming": ("Grito extremo con resonancia hueca, como dentro de un túnel.", None),
    "vocals": ("Categoría de los descriptores de voz.", None),
    "whistle register": ("Registro de silbido: el más agudo de la voz humana, por encima del falsete.", None),
    "whistling": ("Silbido con los labios.", None),
    "epistolary": ("Letra escrita en forma de carta.", None),
    "list song": ("Canción construida como una lista o catálogo.", None),
    "wordplay": ("Juegos de palabras en la letra.", None),

    # --- temas ----------------------------------------------------------------------------
    "anti-authoritarian": ("Tema de oposición a la autoridad y al poder impuesto.", None),
    "anticonsumerism": ("Tema crítico del consumismo.", None),
    "antidiscrimination": ("Tema contra la discriminación.", None),
    "antireligious": ("Tema de oposición a la religión.", None),
    "basketball": ("Tema: baloncesto.", None), "birds": ("Tema: aves.", None), "bugs": ("Tema: insectos y bichos.", None),
    "color": ("Tema: los colores.", None), "confusion": ("Tema: confusión, falta de claridad.", None),
    "creative process": ("Tema: el proceso creativo.", None), "dancing": ("Tema: el baile (de la letra).", None),
    "dishonesty": ("Tema: mentira y engaño.", None), "fans": ("Tema: los fans.", None), "fire": ("Tema: el fuego.", None),
    "fishing": ("Tema: la pesca.", None), "flowers": ("Tema: flores.", None), "gender": ("Tema: género e identidad.", None),
    "gender dysphoria": ("Tema: disforia de género.", None), "gratitude": ("Tema: gratitud.", None),
    "healing": ("Tema: sanación física o emocional.", None), "horses": ("Tema: caballos.", None),
    "hunting": ("Tema: la caza.", None), "kissing": ("Tema: besos.", None), "law": ("Tema: la ley y la justicia.", None),
    "long-distance relationship": ("Tema: relación a distancia.", None), "mathematics": ("Tema: matemáticas.", None),
    "memory": ("Tema: la memoria y los recuerdos.", None), "migration": ("Tema: migración.", None),
    "monsters": ("Tema: monstruos.", None), "Moon": ("Tema: la Luna.", None),
    "older adulthood": ("Tema: la vejez.", None), "opioids": ("Tema: opioides.", None), "pandemic": ("Tema: pandemias.", None),
    "parenthood": ("Tema: maternidad y paternidad.", None), "phones": ("Tema: teléfonos.", None), "plants": ("Tema: plantas.", None),
    "rejection": ("Tema: rechazo.", None), "school": ("Tema: la escuela.", None), "secrets": ("Tema: secretos.", None),
    "sexual": ("Tema sexual en la letra.", "Tema, no sensación: el carácter sugerente es sensual."),
    "shopping": ("Tema: ir de compras.", None), "skateboarding": ("Tema: el skate.", None), "success": ("Tema: el éxito.", None),
    "theft": ("Tema: robo.", None), "time": ("Tema: el paso del tiempo.", None), "trains": ("Tema: trenes.", None),
    "unrequited love": ("Tema: amor no correspondido.", None), "utopian": ("Tema: utopías y sociedades ideales.", None),
    "vampires": ("Tema: vampiros.", None), "vengeance": ("Tema: venganza.", None), "Vikings": ("Tema: vikingos.", None),
    "Wild West": ("Tema: el Viejo Oeste estadounidense.", None), "work": ("Tema: el trabajo.", None),
}
