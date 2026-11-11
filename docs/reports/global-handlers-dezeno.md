# Global handler data: Dezeno (dezeno.com.my)

Step 1 run 2026-11-10 with V21_GLOBAL_HANDLERS=on, on the confirmed official domain. Everything below is exactly what each handler returned, untouched. Raw file: agy-lab/src/v21/runs/2026-11-10T15-38-43_dezeno/step1_research.json (probes with category "global").

Step 2 received all five as registers R4-R8 (the excerpt text as the hit) and produced no finding from them.

---

## ALL-crtsh/w1

- Question: Which subdomains and hostnames have ever had a public SSL certificate under this domain, and since when?
- Status: **found**
- Handler version: 73e5dff3eaf2 | worker: pc-desktop-camhl16 | took: 5514 ms
- Source: https://crt.sh/?q=%25.dezeno.com.my

### What the report would see (excerpt)

```
Certificate Transparency logs for dezeno.com.my (crt.sh):
8 distinct hostnames across 229 certificate entries; first certificate 2017-04-17, latest expiry 2026-12-26.
Issuers: Let's Encrypt (176), Google Trust Services (24), Google Trust Services LLC (12), cPanel, Inc. (10), Cloudflare, Inc. (5), CloudFlare, Inc. (2)
Hostnames (first seen): dezeno.com.my (2017-04-17), mail.dezeno.com.my (2017-04-17), www.dezeno.com.my (2017-04-17), cpanel.dezeno.com.my (2017-04-24), webdisk.dezeno.com.my (2017-04-24), webmail.dezeno.com.my (2017-04-24), cpcalendars.dezeno.com.my (2021-09-30), cpcontacts.dezeno.com.my (2021-09-30)
No hostname contains a test/staging/old-style word.
```

### Full records returned

```json
[
  {
    "domain": "dezeno.com.my",
    "via": "crt.sh",
    "partial": false,
    "cert_rows": 229,
    "hostname_count": 8,
    "first_seen": "2017-04-17",
    "last_expiry": "2026-12-26",
    "issuers": [
      "Let's Encrypt (176)",
      "Google Trust Services (24)",
      "Google Trust Services LLC (12)",
      "cPanel, Inc. (10)",
      "Cloudflare, Inc. (5)",
      "CloudFlare, Inc. (2)"
    ],
    "non_production_names": [],
    "hostnames": [
      {
        "name": "dezeno.com.my",
        "first_seen": "2017-04-17",
        "last_expiry": "2026-12-26",
        "certs": 313,
        "wildcard": true
      },
      {
        "name": "mail.dezeno.com.my",
        "first_seen": "2017-04-17",
        "last_expiry": "2026-12-26",
        "certs": 145,
        "wildcard": false
      },
      {
        "name": "www.dezeno.com.my",
        "first_seen": "2017-04-17",
        "last_expiry": "2026-12-26",
        "certs": 145,
        "wildcard": false
      },
      {
        "name": "cpanel.dezeno.com.my",
        "first_seen": "2017-04-24",
        "last_expiry": "2026-12-26",
        "certs": 48,
        "wildcard": false
      },
      {
        "name": "webdisk.dezeno.com.my",
        "first_seen": "2017-04-24",
        "last_expiry": "2026-12-26",
        "certs": 48,
        "wildcard": false
      },
      {
        "name": "webmail.dezeno.com.my",
        "first_seen": "2017-04-24",
        "last_expiry": "2026-12-26",
        "certs": 48,
        "wildcard": false
      },
      {
        "name": "cpcalendars.dezeno.com.my",
        "first_seen": "2021-09-30",
        "last_expiry": "2026-12-26",
        "certs": 47,
        "wildcard": false
      },
      {
        "name": "cpcontacts.dezeno.com.my",
        "first_seen": "2021-09-30",
        "last_expiry": "2026-12-26",
        "certs": 47,
        "wildcard": false
      }
    ]
  }
]
```

---

## ALL-dns/w1

- Question: Which email provider, sending services and SaaS tools does this domain's DNS show, and how is its email authentication set up?
- Status: **found**
- Handler version: 70118989accb | worker: pc-desktop-camhl16 | took: 208 ms
- Source: https://dnschecker.org/all-dns-records-of-domain.php?query=dezeno.com.my&rtype=ALL

### What the report would see (excerpt)

```
DNS records for dezeno.com.my (read from the worker PC's resolver):
Mail (MX): 10 mx.zoho.com, 20 mx2.zoho.com, 50 mx3.zoho.com -> Zoho Mail
SPF: present, strict (-all: unlisted senders fail); senders listed: Zoho (zoho.com)
Tools shown by verification records: none recognised
Name servers: barbara.ns.cloudflare.com, nitin.ns.cloudflare.com -> Cloudflare
```

### Full records returned

```json
[
  {
    "domain": "dezeno.com.my",
    "mx": [
      {
        "priority": 10,
        "exchange": "mx.zoho.com"
      },
      {
        "priority": 20,
        "exchange": "mx2.zoho.com"
      },
      {
        "priority": 50,
        "exchange": "mx3.zoho.com"
      }
    ],
    "mail_provider": [
      "Zoho Mail"
    ],
    "spf": {
      "present": true,
      "record_count": 1,
      "record": "v=spf1 include:zoho.com -all",
      "strictness": "strict (-all: unlisted senders fail)",
      "senders": [
        {
          "host": "zoho.com",
          "vendor": "Zoho"
        }
      ]
    },
    "ns": [
      "barbara.ns.cloudflare.com",
      "nitin.ns.cloudflare.com"
    ],
    "ns_provider": [
      "Cloudflare"
    ],
    "txt_verifications": [],
    "txt_record_count": 1,
    "query_errors": []
  }
]
```

---

## ALL-ssl/w1

- Question: Who issued the website's SSL certificate, when does it expire, and does it cover the domain?
- Status: **found**
- Handler version: 7f34086e20a2 | worker: pc-desktop-camhl16 | took: 242 ms
- Source: https://crt.sh/?q=dezeno.com.my

### What the report would see (excerpt)

```
SSL certificate served by dezeno.com.my:
Issuer: Let's Encrypt / YR1
Valid 2026-11-04 to 2027-02-02 (83 days left; 90-day certificate)
Trusted chain: yes
Covers dezeno.com.my: yes
Names on the certificate (2): dezeno.com.my, www.dezeno.com.my
```

### Full records returned

```json
[
  {
    "host": "dezeno.com.my",
    "subject": "dezeno.com.my",
    "issuer_org": "Let's Encrypt",
    "issuer_name": "YR1",
    "valid_from": "2026-11-04",
    "valid_to": "2027-02-02",
    "days_left": 83,
    "expired": false,
    "lifetime_days": 90,
    "trusted_chain": true,
    "trust_error": null,
    "covers_host": true,
    "mismatch": null,
    "names": [
      "dezeno.com.my",
      "www.dezeno.com.my"
    ],
    "name_count": 2,
    "protocol": "TLSv1.3",
    "fingerprint256": "78:41:4C:DB:12:1C:26:3C:37:D5:58:B5:33:AD:44:70:F3:9D:BA:33:2F:EA:32:31:A1:D3:29:FB:8A:28:34:E5"
  }
]
```

---

## ALL-wayback/w1

- Question: How long has this website existed in the Internet Archive, and what did its home page say in earlier years?
- Status: **found**
- Handler version: ce0ba6fe168f | worker: pc-desktop-camhl16 | took: 34108 ms
- Source: https://web.archive.org/web/*/dezeno.com.my

### What the report would see (excerpt)

```
Internet Archive for dezeno.com.my: first successful capture 2014-07-06; captured in 12 different years (2014 to 2026).
Years with a capture: 2014, 2015, 2016, 2017, 2018, 2020, 2021, 2022, 2023, 2024, 2025, 2026
Snapshot 2014-07-06 (https://web.archive.org/web/20140706163932/http://www.dezeno.com.my:80/): could not be read (HTTP 429)
Snapshot 2023-02-07 (https://web.archive.org/web/20230207192139/https://dezeno.com.my/): could not be read (HTTP 429)
Snapshot 2025-02-10 (https://web.archive.org/web/20250210112257/https://dezeno.com.my/): could not be read (HTTP 429)
```

### Full records returned

```json
[
  {
    "domain": "dezeno.com.my",
    "first_snapshot": "2014-07-06",
    "last_snapshot_year": "2026",
    "years_archived": [
      "2014",
      "2015",
      "2016",
      "2017",
      "2018",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026"
    ],
    "snapshots": [
      {
        "timestamp": "20140706163932",
        "date": "2014-07-06",
        "url": "https://web.archive.org/web/20140706163932/http://www.dezeno.com.my:80/",
        "error": "HTTP 429"
      },
      {
        "timestamp": "20230207192139",
        "date": "2023-02-07",
        "url": "https://web.archive.org/web/20230207192139/https://dezeno.com.my/",
        "error": "HTTP 429"
      },
      {
        "timestamp": "20250210112257",
        "date": "2025-02-10",
        "url": "https://web.archive.org/web/20250210112257/https://dezeno.com.my/",
        "error": "HTTP 429"
      }
    ]
  }
]
```

---

## ALL-youtube/w1

- Question: Does the website link a YouTube channel, and when did that channel last post and how often?
- Status: **found**
- Handler version: f5a8f8b14d5e | worker: pc-desktop-camhl16 | took: 1092 ms
- Source: https://dezeno.com.my/

### What the report would see (excerpt)

```
YouTube channels linked from https://dezeno.com.my/:
DEZENO_SB (https://www.youtube.com/channel/UCHYiLYRp5JoMwVY534NRJuw): last video 2026-11-09, 1 days ago; 15 videos in the last 90 days, 15 in the last 365; about 3.4 days between the newest 15.
  2026-11-09  Bringing a vision to life, one piece of furniture at a time.
  2026-11-06  A 4-Storey Home With Its Own Soul ✨
  2026-11-03  Transition to a peaceful home ✨
The feed lists only the newest 15 videos, so older history is not shown.
```

### Full records returned

```json
[
  {
    "path": "@dezeno_sb",
    "channel_id": "UCHYiLYRp5JoMwVY534NRJuw",
    "channel_url": "https://www.youtube.com/channel/UCHYiLYRp5JoMwVY534NRJuw",
    "title": "DEZENO_SB",
    "feed_videos": 15,
    "last_post": "2026-11-09",
    "days_since_last_post": 1,
    "posts_last_90_days": 15,
    "posts_last_365_days": 15,
    "average_days_between_posts": 3.4,
    "newest": [
      {
        "date": "2026-11-09",
        "title": "Bringing a vision to life, one piece of furniture at a time.",
        "url": "https://www.youtube.com/watch?v=OTA5h8q3nB8"
      },
      {
        "date": "2026-11-06",
        "title": "A 4-Storey Home With Its Own Soul ✨",
        "url": "https://www.youtube.com/watch?v=Lq6zOvtsbJA"
      },
      {
        "date": "2026-11-03",
        "title": "Transition to a peaceful home ✨",
        "url": "https://www.youtube.com/watch?v=dxR6rsPxn6w"
      },
      {
        "date": "2026-10-30",
        "title": "Watch This Bedroom Get a Complete Makeover",
        "url": "https://www.youtube.com/watch?v=Zzlm6zjXW94"
      },
      {
        "date": "2026-10-27",
        "title": "Ready for new project ✨ The Mansions",
        "url": "https://www.youtube.com/watch?v=DJfbQjDZeVw"
      }
    ],
    "feed_is_capped_at_15": true
  }
]
```

