@echo off
REM Abre o instalador premium do VelosoSolution no navegador.
REM Duplo-clique neste arquivo. Feche a janela pra parar o servidor.
title VelosoSolution - Instalador
node "%~dp0cli.mjs"
echo.
echo (servidor encerrado)
pause
