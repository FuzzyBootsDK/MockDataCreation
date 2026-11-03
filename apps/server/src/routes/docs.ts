import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export async function docsRoutes(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: "mockgen",
        description: "Mock data generator: schemas, file generation, mock REST endpoints and database seeding.",
        version: "0.1.0",
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}
