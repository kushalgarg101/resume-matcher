from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import feedparser

from app.jobs.sources.base import JobSource, normalized_job

# (name, url, is_remote_default)
_RSS_FEEDS: list[tuple[str, str, bool]] = [
    ("weworkremotely", "https://weworkremotely.com/remote-jobs.rss", True),
    ("himalayas", "https://himalayas.app/jobs/rss", True),
    ("hireweb3", "https://hireweb3.io/job/rss", True),
]

_FEED_COMPANY_FIELDS: dict[str, str] = {
    "himalayas": "himalayasjobs_companyname",
    "hireweb3": "hireweb3jobs_companyname",
}

_FEED_LOCATION_FIELDS: dict[str, str] = {
    "himalayas": "himalayasjobs_locationrestriction",
    "hireweb3": "hireweb3jobs_location",
}

_FEED_LOGO_FIELDS: dict[str, str] = {
    "hireweb3": "hireweb3jobs_companylogo",
}


class RSSSource(JobSource):
    @property
    def name(self) -> str:
        return "rss"

    def fetch(self) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []
        for feed_name, feed_url, _ in _RSS_FEEDS:
            try:
                feed = feedparser.parse(feed_url)
                for entry in feed.entries:
                    job = self._normalize(entry, feed_name, feed_url)
                    if job:
                        jobs.append(job)
            except Exception:
                pass
        return jobs

    def _normalize(self, entry: feedparser.FeedParserDict, feed_name: str, feed_url: str) -> dict[str, Any] | None:
        title = (entry.get("title") or "").strip()
        if not title:
            return None

        company = self._extract_company(entry, title, feed_name)
        clean_title = self._clean_title(title, company, feed_name)
        description = (entry.get("summary") or entry.get("description") or "").strip()
        link = (entry.get("link") or "").strip()

        published = entry.get("published_parsed") or entry.get("updated_parsed")
        posted_at = None
        if published:
            try:
                posted_at = datetime(*published[:6], tzinfo=timezone.utc).isoformat()
            except (TypeError, ValueError):
                posted_at = None

        location = self._extract_location(entry, feed_name)
        logo = self._extract_logo(entry, feed_name)

        employment_type = None
        if feed_name == "weworkremotely":
            et = (entry.get("type") or "").strip()
            if et:
                employment_type = et.lower()

        return normalized_job(
            external_id=entry.get("id") or entry.get("guid") or link,
            source=feed_name,
            title=clean_title,
            company_name=company,
            company_logo=logo,
            location=location,
            description=description,
            application_url=link,
            employment_type=employment_type,
            is_remote=True,
            posted_at=posted_at,
        )

    def _extract_company(self, entry: feedparser.FeedParserDict, title: str, feed_name: str) -> str:
        author = (entry.get("author") or "").strip()
        if author:
            return author

        field = _FEED_COMPANY_FIELDS.get(feed_name)
        if field:
            val = entry.get(field)
            if val:
                if isinstance(val, dict):
                    val = val.get("href") or val.get("url") or ""
                val = str(val).strip()
                if val:
                    return val

        if ": " in title:
            parts = title.split(": ", 1)
            candidate = parts[0].strip()
            if candidate and not candidate.lower().startswith(("job", "hiring")):
                return candidate

        for sep in [" at ", " @ ", " | "]:
            parts = title.split(sep)
            if len(parts) >= 2:
                return parts[-1].strip()

        return "Unknown Company"

    def _clean_title(self, title: str, company: str, feed_name: str) -> str:
        t = title
        if feed_name == "weworkremotely" and company and t.startswith(company + ": "):
            t = t[len(company) + 2:].strip()
        for sep in [" at ", " @ ", " | "]:
            t = t.split(sep)[0].strip() if sep in t else t
        if t.lower().startswith("hiring "):
            t = t[7:].strip()
        if t.lower().startswith("job: "):
            t = t[5:].strip()
        return t or title

    def _extract_location(self, entry: feedparser.FeedParserDict, feed_name: str) -> str | None:
        field = _FEED_LOCATION_FIELDS.get(feed_name)
        if field:
            val = entry.get(field)
            if val and str(val).strip():
                return str(val).strip()
        if feed_name == "weworkremotely":
            region = (entry.get("region") or "").strip()
            if region and region.lower() not in ("", "anywhere in the world"):
                return region
        tags = entry.get("tags") or []
        for tag in tags:
            term = (tag.get("term") or "").strip()
            if term.lower() in ("remote", "anywhere"):
                continue
            if "/" in term or "," in term or len(term) > 3:
                return term
        return None

    def _extract_logo(self, entry: feedparser.FeedParserDict, feed_name: str) -> str | None:
        field = _FEED_LOGO_FIELDS.get(feed_name)
        if field:
            val = entry.get(field)
            if val:
                if isinstance(val, dict):
                    return val.get("href") or val.get("url") or ""
                return str(val).strip() or None
        media = entry.get("media_content") or entry.get("media_thumbnail") or []
        for m in media:
            url = m.get("url")
            if url:
                return url
        links = entry.get("links") or []
        for link in links:
            if link.get("type", "").startswith("image/"):
                return link.get("href")
        return None
