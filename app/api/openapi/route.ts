import { NextResponse } from "next/server";

/**
 * GET /api/openapi
 *
 * Returns an OpenAPI 3.1 document describing the externally-callable
 * EDRMS endpoints. No authentication required — this is a discovery
 * document so integrators can introspect what's available.
 *
 * The spec is intentionally a hand-written stub: it lists the routes
 * and their basic shape, but does not exhaustively model every
 * response schema. Grow it as the integration surface stabilises.
 */

const SECURITY_SCHEMES = {
  apiKey: {
    type: "apiKey",
    in: "header",
    name: "x-api-key",
    description:
      "Bcrypt-hashed API key issued from the admin API-keys console. Matches the `ApiKey` row in the database.",
  },
} as const;

const SPEC = {
  openapi: "3.1.0",
  info: {
    title: "EDRMS Public API",
    version: "0.1.0",
    description:
      "Externally-callable endpoints for the Karatina EDRMS. Authenticate with `x-api-key`. This is a stub spec — endpoint shapes are summarised; consult source for full payloads.",
  },
  servers: [{ url: "/" }],
  security: [{ apiKey: [] }],
  tags: [
    { name: "Documents", description: "Document records & metadata" },
    { name: "Files", description: "Document file content" },
    { name: "Search", description: "Cross-corpus search" },
    { name: "Workflows", description: "Workflow instances & triggers" },
    { name: "Forms", description: "Form definitions & submissions" },
    { name: "External locks", description: "Third-party document locking" },
    { name: "Embed", description: "Short-lived embed tokens" },
  ],
  components: {
    securitySchemes: SECURITY_SCHEMES,
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      Document: {
        type: "object",
        description: "Document metadata record. See `Document` Prisma model for full shape.",
        additionalProperties: true,
      },
      Workflow: {
        type: "object",
        description: "Workflow instance.",
        additionalProperties: true,
      },
      Form: {
        type: "object",
        description: "Form definition.",
        additionalProperties: true,
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid `x-api-key`.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Resource not found.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  paths: {
    "/api/documents": {
      get: {
        tags: ["Documents"],
        summary: "List documents accessible to the caller.",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" }, description: "Free-text filter." },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Page of documents.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/Document" } },
                    nextCursor: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/documents/{id}": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      get: {
        tags: ["Documents"],
        summary: "Fetch a single document.",
        responses: {
          "200": {
            description: "Document detail.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Document" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Documents"],
        summary: "Partially update a document's metadata.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Document" } } },
        },
        responses: {
          "200": {
            description: "Updated document.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Document" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["Documents"],
        summary: "Delete a document (soft-delete where supported).",
        responses: {
          "204": { description: "Deleted." },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/files": {
      get: {
        tags: ["Files"],
        summary: "Stream a document file by storage path.",
        parameters: [
          {
            name: "path",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Storage-relative path of the file blob.",
          },
        ],
        responses: {
          "200": {
            description: "Raw file bytes.",
            content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/search": {
      get: {
        tags: ["Search"],
        summary: "Cross-corpus search across documents, memos, correspondence.",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "type", in: "query", schema: { type: "string" }, description: "Optional corpus filter." },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Ranked hits.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/workflows": {
      post: {
        tags: ["Workflows"],
        summary: "Start a workflow instance from a template.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  templateId: { type: "string" },
                  data: { type: "object", additionalProperties: true },
                },
                required: ["templateId"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Instance created.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Workflow" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/workflows/{id}": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      get: {
        tags: ["Workflows"],
        summary: "Fetch a workflow instance with current state.",
        responses: {
          "200": {
            description: "Workflow instance.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Workflow" } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/workflows/triggers": {
      post: {
        tags: ["Workflows"],
        summary: "Fire an external trigger that may start one or more workflows.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  key: { type: "string", description: "Trigger key registered in the workflow designer." },
                  payload: { type: "object", additionalProperties: true },
                },
                required: ["key"],
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Trigger accepted.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/forms": {
      get: {
        tags: ["Forms"],
        summary: "List published form definitions.",
        responses: {
          "200": {
            description: "Form list.",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Form" } },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/forms/{id}/submissions": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      post: {
        tags: ["Forms"],
        summary: "Submit a filled form.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { data: { type: "object", additionalProperties: true } },
                required: ["data"],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Submission accepted.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/documents/{id}/external-lock": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      post: {
        tags: ["External locks"],
        summary: "Acquire an external lock on a document.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  sourceSystem: { type: "string" },
                  sourceType: { type: "string" },
                  sourceRef: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["sourceSystem", "sourceType", "sourceRef"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Lock acquired.",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "Already locked by another source.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
      delete: {
        tags: ["External locks"],
        summary: "Release the caller's external lock on a document.",
        responses: {
          "204": { description: "Released." },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/documents/{id}/embed-token": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      post: {
        tags: ["Embed"],
        summary: "Mint a short-lived (~15 min) signed token for iframe embedding.",
        responses: {
          "200": {
            description: "Token minted.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: { type: "string" },
                    expiresAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
  },
} as const;

export function GET() {
  return NextResponse.json(SPEC);
}
