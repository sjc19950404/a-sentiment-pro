import akshare as ak
import requests
import time
import os
from datetime import datetime

WEBHOOK = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=3a20cfcf-9607-4289-a7ee-a6b073e4726b"
CAP_LIMIT = 8000000000

KEYWORDS = [
    "重大资产重组", "发行股份购买资产",
    "控制权变更", "实际控制人变更", "实控人变更",
    "协议转让", "吸收合并", "要约收购"
]

GREEN = ["产业链", "整合", "战略投资", "战投", "优质", "协同"]
RED = ["亏损", "借壳", "跨界", "财务", "退市"]

def push_wechat(msg):
    try:
        requests.post(WEBHOOK, json={"msgtype": "text", "text": {"content": "重组雷达:\n" + msg}}, timeout=10)
        print(">>> Push to Wechat success!")
    except Exception as e:
        print(">>> Push failed: " + str(e))

def rule_score(title):
    if any(k in title for k in RED) or "ST" in title.upper():
        return "[R] rule: risky or shell"
    if any(k in title for k in GREEN):
        return "[G] rule: good integration"
    return "[Y] rule: normal deal"

def get_cap(code):
    if code.startswith("6"):
        q = "sh" + code
    elif code.startswith(("0", "3")):
        q = "sz" + code
    else:
        q = "bj" + code
    for i in range(3):
        try:
            r = requests.get("https://qt.gtimg.cn/q=" + q, timeout=10)
            r.encoding = "gbk"
            parts = r.text.split("~")
            nm = parts[1]
            mcap = float(parts[45]) * 1e8
            return nm, mcap
        except:
            time.sleep(2)
    return None, 0

if __name__ == "__main__":
    print(">>> [" + datetime.now().strftime('%H:%M:%S') + "] Start scanning...")
    try:
        date = datetime.now().strftime("%Y%m%d")
        notices = ak.stock_notice_report(date=date)
    except Exception as e:
        print("!!! FATAL: " + str(e))
        exit()

    if notices is None or notices.empty:
        print("No notices today")
        exit()

    hit = notices[notices["公告标题"].apply(lambda t: isinstance(t, str) and any(k in t for k in KEYWORDS))]
    if hit.empty:
        print("No hard signals today")
        exit()

    print("--- Found " + str(len(hit)) + " hard signals ---")
    
    # 兼容云端（GitHub Actions）与本地（文件）的去重逻辑
    in_github_actions = "GITHUB_ACTION" in os.environ
    pushed = set()
    if not in_github_actions:
        dedup_file = "/tmp/sentiment_pushed.txt"
        try:
            with open(dedup_file, 'r') as f:
                pushed = set(line.strip() for line in f if line.strip())
        except:
            pass

    out = []
    new_pushed = set()
    seen = set()

    for _, row in hit.iterrows():
        c = str(row["代码"]).strip()
        if c in seen:
            continue
        seen.add(c)
        title = row["公告标题"]
        key = f"{c}|{title}"
        
        if key in pushed:
            print(f"  >> Skipped (already pushed): {c} {title}")
            continue

        print("  >> Checking cap for " + c)
        nm, cap = get_cap(c)
        analysis = rule_score(title)
        
        if nm is None:
            out.append(analysis + "\n[" + c + " cap:NA] " + title)
            new_pushed.add(key)
            time.sleep(1)
            continue
        
        if "ST" in nm.upper():
            print("     ! skip ST: " + nm)
            continue
        
        if cap > 0 and cap < CAP_LIMIT:
            print("  >> Rule Analyzing: " + nm)
            out.append(analysis + "\n[" + c + " " + nm + " cap:" + str(round(cap/1e8, 1)) + "Y] " + title)
            new_pushed.add(key)
        else:
            print("     ! skip large cap: " + nm)
        
        time.sleep(1)

    if out:
        final_msg = "\n\n".join(out)
        print("\n" + "=" * 30)
        print(final_msg)
        print("=" * 30)
        push_wechat(final_msg)
        
        # 只有在本地运行时，才写入去重文件
        if not in_github_actions:
            with open("/tmp/sentiment_pushed.txt", 'a') as f:
                for p in new_pushed:
                    f.write(p + "\n")
    else:
        print("No new targets matched.")
