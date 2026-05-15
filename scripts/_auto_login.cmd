@echo off
cd /d C:\Users\Administrator\Desktop\temu-automation
.\node_modules\.bin\electron.cmd .\scripts\_auto_login.cjs 1>logs\_auto_login.out.log 2>logs\_auto_login.err.log
