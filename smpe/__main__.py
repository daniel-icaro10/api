"""CLI:
  python -m smpe importar "C:\\caminho\\SIS SMPE 2026.4.xlsm"   # importa todas as abas
  python -m smpe web [--porta 8010]
  python -m smpe migrar data\\smpe.db [--substituir]   # copia o SQLite para o Postgres de DATABASE_URL
"""
import argparse
import sys


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="smpe")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("importar", help="importa a planilha SIS SMPE completa")
    i.add_argument("arquivo")
    m = sub.add_parser("migrar", help="copia um banco SQLite para o Postgres de DATABASE_URL")
    m.add_argument("arquivo")
    m.add_argument("--substituir", action="store_true", help="apaga o que ja existe no Postgres")
    w = sub.add_parser("web", help="abre o sistema")
    w.add_argument("--porta", type=int, default=8010)
    w.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    if args.cmd == "importar":
        from .importer import import_workbook

        import_workbook(args.arquivo)
    elif args.cmd == "migrar":
        from .migrar import migrar

        migrar(args.arquivo, args.substituir)
    else:
        import uvicorn

        print(f"SIS SMPE em http://{args.host}:{args.porta}")
        uvicorn.run("smpe.web:app", host=args.host, port=args.porta, log_level="warning")


if __name__ == "__main__":
    main()
