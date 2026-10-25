import { describe, expect, it } from "vitest";
import { aiResolutionProposalSchema } from "../../src/ai/contracts.js";
import { DeepSeekGateway, FetchDeepSeekTransport, MemoryDeepSeekRunStore, type DeepSeekGatewayConfig } from "../../src/ai/gateway.js";
import { z } from "zod";
import { chromium } from "playwright";

const apiKey = process.env["DEEPSEEK_API_KEY"];
const enabled = process.env["RUN_DEEPSEEK_INTEGRATION"] === "1" && Boolean(apiKey);

describe.runIf(enabled)("DeepSeek real (opt-in)", () => {
  it("acepta una respuesta estructurada del endpoint real", async () => {
    const config: DeepSeekGatewayConfig = {
      ...(apiKey === undefined ? {} : { apiKey }),
      baseUrl: process.env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com",
      models: {
        fast: process.env["DEEPSEEK_MODEL_FAST"] ?? "deepseek-flash",
        reasoning: process.env["DEEPSEEK_MODEL_REASONING"] ?? "deepseek-v4-pro",
        vision: process.env["DEEPSEEK_MODEL_FAST"] ?? "deepseek-flash",
      },
      maxTokens: 3000, timeoutMs: 60_000,
    };
    const gateway = new DeepSeekGateway(config, new FetchDeepSeekTransport(), new MemoryDeepSeekRunStore());
    const result = await gateway.propose({
      taskKind: "hard_entity_resolution", schemaVersion: "real-smoke.v1",
      input: { a: { name: "Pacifica" }, b: { name: "Pacífica" }, context: "sin mas evidencia" },
      instructions: "La tilde sola no basta. Entrega las cinco claves requeridas y recomienda REVIEW.",
      responseSchema: aiResolutionProposalSchema,
    });
    expect(result.proposal.same_entity_probability).toBeGreaterThanOrEqual(0);
    expect(result.proposal.same_entity_probability).toBeLessThanOrEqual(1);
  }, 90_000);
  it("lee texto de los píxeles con el endpoint de visión real",async()=>{
    const browser=await chromium.launch({headless:true});
    let png:Buffer;
    try{const page=await browser.newPage({viewport:{width:600,height:180}});await page.setContent('<div style="font: bold 48px Arial; padding:40px; color:black; background:white">VISION 4826</div>');png=await page.screenshot({type:"png"});}finally{await browser.close();}
    const gateway=new DeepSeekGateway({...(apiKey===undefined?{}:{apiKey}),baseUrl:process.env["DEEPSEEK_BASE_URL"]??"https://api.deepseek.com",models:{fast:"deepseek-flash",reasoning:"deepseek-v4-pro",vision:process.env["DEEPSEEK_MODEL_FAST"]??"deepseek-flash"},maxTokens:150,timeoutMs:60000},new FetchDeepSeekTransport(),new MemoryDeepSeekRunStore());
    const result=await gateway.propose({taskKind:"vision_analysis",schemaVersion:"real-vision-smoke.v1",instructions:"Transcribe exactamente el texto legible de la imagen. Devuelve solamente {text:string}.",responseSchema:z.object({text:z.string()}).strict(),input:{purpose:"Verificar transporte de píxeles; el texto objetivo no se suministra al modelo."},images:[{sourceUrl:"https://qa.invalid/vision-fixture.png",dataUrl:`data:image/png;base64,${png.toString("base64")}`}]});
    expect(result.proposal.text.replace(/\s+/gu," ").trim()).toBe("VISION 4826");
  },90000);
});

