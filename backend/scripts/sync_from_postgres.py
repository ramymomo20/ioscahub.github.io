from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.db import create_hub_postgres_pool, create_postgres_pool  # noqa: E402
from app.sync import sync_all  # noqa: E402


async def main(*, force_full: bool = False) -> None:
    pg_pool = await create_postgres_pool()
    hub_pool = await create_hub_postgres_pool()
    try:
        results = await sync_all(pg_pool, hub_pool, force_full=force_full)
    finally:
        await pg_pool.close()
        await hub_pool.close()

    total = 0
    for result in results:
        total += result.rows
        print(f"{result.table}: {result.rows}")
    print(f"total: {total}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync hub schema from public Postgres tables")
    parser.add_argument(
        "--force-full",
        action="store_true",
        help="Ignore incremental watermarks and mirror all hub tables from source data.",
    )
    args = parser.parse_args()
    asyncio.run(main(force_full=args.force_full))
