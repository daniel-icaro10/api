@echo off
cd /d "%~dp0"
rem instala/atualiza as dependencias (ex.: xlrd para ler .xls)
python -m pip install -q -r requirements.txt
start "" http://127.0.0.1:8010
python -m smpe web
