// whatsapp-webhook — ponto de entrada. Toda a lógica está em ./logica.ts.
import { handler } from "./logica.ts";

Deno.serve((req: Request) => handler(req));
