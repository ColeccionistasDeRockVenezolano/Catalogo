/** Servidor de QA: API real sin arrancar capturadores ni tareas de fondo. */
import { buildApp } from '../src/api/app.js';
const app=await buildApp();
await app.listen({port:Number(process.env['PORT']??8082),host:'127.0.0.1'});
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
