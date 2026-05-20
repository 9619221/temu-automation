# -*- coding: utf-8 -*-
# 只读导出聚协云本地库 schema 与样本,定位复刻数据模型
import os, sqlite3, json, glob

root = os.path.join(os.environ["APPDATA"], "droplet-client")

def dump(label, path):
    print("\n==== %s ====\n%s" % (label, path))
    if not os.path.exists(path):
        print("  (不存在)"); return
    try:
        con = sqlite3.connect("file:%s?mode=ro" % path.replace("\\", "/"), uri=True)
    except Exception as e:
        print("  打不开:", e); return
    cur = con.cursor()
    try:
        tabs = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    except Exception as e:
        print("  读表失败:", e); con.close(); return
    for t in tabs:
        try:
            n = cur.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
            cols = [c[1] for c in cur.execute('PRAGMA table_info("%s")' % t)]
            print("  表 %s 行数=%d" % (t, n))
            print("    列: %s" % ", ".join(cols))
            if n:
                row = cur.execute('SELECT * FROM "%s" LIMIT 1' % t).fetchone()
                s = json.dumps(dict(zip(cols, row)), ensure_ascii=False, default=str)
                print("    样本: %s" % (s[:700]))
        except Exception as e:
            print("  表 %s 出错: %s" % (t, e))
    con.close()

dump("主库 data.db", os.path.join(root, "data.db"))
dump("plugin.db", os.path.join(root, "droplet", "plugin.db"))
dump("RPA调度库 plugin_db_rpa_schedule.db", os.path.join(root, "db", "plugin_db_rpa_schedule.db"))
for d in sorted(glob.glob(os.path.join(root, "pluginPackages", "*", "*"))):
    for f in ("tasks.db", "cache.db"):
        fp = os.path.join(d, f)
        if os.path.exists(fp):
            dump("插件 %s / %s" % (os.path.basename(d), f), fp)
