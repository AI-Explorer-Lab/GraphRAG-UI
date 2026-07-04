# GraphRAG UI

Vue + Vite frontend for the GraphRAG demo. It talks to the backend API through the Vite dev proxy.

## Prerequisites

Start FalkorDB and the backend API first from the backend project:

```powershell
cd F:\graphrag
docker compose -f deploy/docker-compose.falkordb.yml up -d
python main.py --reload
```

The backend should be available at:

```text
http://localhost:8001
```

## Start The Frontend

Open a second terminal:

```powershell
cd F:\graphrag-ui
npm install
npm run dev
```

Then open:

```text
http://localhost:5174
```

## Useful Commands

```powershell
npm run dev      # Start local dev server on port 5174
npm run build    # Type-check and build production assets
npm run preview  # Preview the production build on port 4173
```

## Runtime Notes

- Frontend API calls use the `/v1` proxy configured by Vite.
- The backend reads `configs/local.yaml` by default when started with `python main.py --reload`.
- Graphs imported from the UI are persisted to FalkorDB when the backend is connected to FalkorDB.
- The graph list in the UI comes from the backend `/v1/graphs` endpoint; after backend restart, the backend syncs the list from FalkorDB.
