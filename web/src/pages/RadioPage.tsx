// CRV · /radio — la emisión compartida, con el mismo reproductor de la portada.
import { useI18n } from "../lib/i18n";
import { RadioEmbed } from "../components/RadioEmbed";
import "../styles/radio.css";

export function RadioPage() {
  const { lang } = useI18n();
  return (
    <div className="radio-page">
      <RadioEmbed unavailable={lang === "en" ? "The radio is not available right now." : "La radio no está disponible en este momento."} />
    </div>
  );
}
