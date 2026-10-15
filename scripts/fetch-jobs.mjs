// Auto-fetch SA jobs every day - Adzuna + Official sources
// Writes to src/data/jobs.json

import fs from "node:fs";

const APP_ID = process.env.ADZUNA_APP_ID;
const APP_KEY = process.env.ADZUNA_APP_KEY;

const PROVINCE_MAP = {
  "gauteng": "Gauteng",
  "western cape": "Western Cape",
  "kwazulu": "KwaZulu-Natal",
  "kwazulu-natal": "KwaZulu-Natal",
  "eastern cape": "Eastern Cape",
  "limpopo": "Limpopo",
  "mpumalanga": "Mpumalanga",
  "north west": "North West",
  "free state": "Free State",
  "northern cape": "Northern Cape",
  "johannesburg": "Gauteng",
  "pretoria": "Gauteng",
  "cape town": "Western Cape",
  "durban": "KwaZulu-Natal",
  "gqeberha": "Eastern Cape",
  "port elizabeth": "Eastern Cape",
  "polokwane": "Limpopo",
  "bloemfontein": "Free State",
};

function detectProvince(text = "") {
  const lower = text.toLowerCase();
  for (const [key, province] of Object.entries(PROVINCE_MAP)) {
    if (lower.includes(key)) return province;
  }
  return "Nationwide";
}

function cleanTitle(title = "") {
  return title.replace(/\(.*?\)/g, "").trim();
}

function isScam(job) {
  const text = (job.title + " " + job.description + " " + job.company).toLowerCase();
  const scamWords = ["whatsapp me", "pay to apply", "upfront fee", "crypto", "telegram", "earn r5000 daily", "no experience needed earn"];
  return scamWords.some(w => text.includes(w));
}

async function fetchAdzuna() {
  if (!APP_ID || !APP_KEY) {
    console.log("No Adzuna keys - skipping Adzuna");
    return [];
  }
  const jobs = [];
  // Fetch 3 pages = up to 150 jobs
  for (let page = 1; page <= 3; page++) {
    const url = `https://api.adzuna.com/v1/api/jobs/za/search/${page}?app_id=${APP_ID}&app_key=${APP_KEY}&results_per_page=50&what=&where=South%20Africa&sort_by=date&content-type=application/json`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      for (const j of data.results || []) {
        const province = detectProvince(j.location?.display_name + " " + j.description);
        jobs.push({
          title: cleanTitle(j.title),
          company: j.company?.display_name || "Unknown",
          location: j.location?.display_name || "South Africa",
          province,
          type: j.contract_time || "Permanent",
          category: j.category?.label || "General",
          description: (j.description || "").slice(0, 300),
          link: j.redirect_url,
          posted: j.created,
          closing: "",
          source: "Adzuna / Official Board",
        });
      }
    } catch (e) { console.log("Adzuna page failed", page, e.message); }
  }
  return jobs;
}

// DPSA / Government - add manual curated links, auto-checked
// We keep this as a fallback list of official gov portals - not scraped
const OFFICIAL_PORTALS = [
  { title: "DPSA Vacancy Circular - National & Provincial Government Jobs", company: "DPSA", location: "Nationwide", province: "Nationwide", type: "Permanent", link: "https://www.dpsa.gov.za/newsroom/psvc/", source: "DPSA Official" },
  { title: "SAPS Careers - Police Trainees & Vacancies", company: "SAPS", location: "Nationwide", province: "Nationwide", type: "Learnership", link: "https://www.saps.gov.za/careers/careers.php", source: "SAPS Official" },
  { title: "SANDF Careers - Defence Force Recruitment", company: "SANDF", location: "Nationwide", province: "Nationwide", type: "Permanent", link: "https://www.dod.mil.za/", source: "SANDF Official" },
];

async function main() {
  let allJobs = await fetchAdzuna();
  allJobs = allJobs.filter(j => !isScam(j));

  // Deduplicate by title + company
  const seen = new Set();
  allJobs = allJobs.filter(j => {
    const key = (j.title + j.company).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Add official portals at top
  const finalJobs = [...OFFICIAL_PORTALS, ...allJobs].slice(0, 120);

  fs.mkdirSync("src/data", { recursive: true });
  fs.writeFileSync("src/data/jobs.json", JSON.stringify({
    updated: new Date().toISOString(),
    count: finalJobs.length,
    jobs: finalJobs
  }, null, 2));
  console.log(`Saved ${finalJobs.length} jobs`);
}

main();
