import { describe, expect, test } from "bun:test";
import {
  APP_STORE_STOREFRONTS,
  awaitsReply,
  STOREFRONTS_PER_CALL,
  appStoreReviews,
  averageStars,
  countryName,
  languageName,
  mergePlayReviews,
  playApiReviews,
  playPageRatingCount,
  playReportReviews,
  sentimentOf,
  steamReviews,
  steamVerdict,
  sumAppStoreRatings,
} from "./reviews";

describe("countries and languages", () => {
  test("every App Store storefront has a unique code and an English name", () => {
    expect(APP_STORE_STOREFRONTS).toHaveLength(175);
    expect(new Set(APP_STORE_STOREFRONTS).size).toBe(175);
    for (const code of APP_STORE_STOREFRONTS) {
      expect(countryName(code)).not.toBe(code);
    }
    expect(STOREFRONTS_PER_CALL).toBeLessThan(50);
  });

  test("names App Store Connect's alpha-3 territories", () => {
    expect(countryName("ESP")).toBe("Spain");
    expect(countryName("XKS")).toBe("Kosovo");
    expect(countryName("es")).toBe("Spain");
    expect(countryName(null)).toBeNull();
  });

  test("names Google Play's language codes", () => {
    expect(languageName("pt")).toBe("Portuguese");
    expect(languageName("es_419")).toBe("Latin American Spanish");
  });
});

// Didactic Jesus Game (6740145520), 2026-09-30, with a reply added to show `included`.
const appStorePage = {
  data: [
    {
      type: "customerReviews",
      id: "00000191-be75-7003-3836-082100000000",
      attributes: {
        rating: 5,
        title: "Thank you",
        body: "Amazing",
        reviewerNickname: "God is Loveee",
        createdDate: "2026-03-08T13:22:08-07:00",
        territory: "ESP",
      },
      relationships: { response: { data: { type: "customerReviewResponses", id: "resp-1" } } },
    },
    {
      type: "customerReviews",
      id: "00000191-be75-7003-087d-471700000000",
      attributes: {
        rating: 2,
        title: "Recomendable",
        body: "Muy interesante para que los niños jueguen.",
        reviewerNickname: "Jonatan CO",
        createdDate: "2025-08-17T06:46:10-07:00",
        territory: "MEX",
      },
      relationships: { response: { data: null } },
    },
  ],
  included: [
    {
      type: "customerReviewResponses",
      id: "resp-1",
      attributes: {
        responseBody: "Thanks!",
        lastModifiedDate: "2026-03-09T10:00:00-07:00",
        state: "PENDING_PUBLISH",
      },
    },
  ],
};

describe("App Store", () => {
  test("maps reviews and their replies", () => {
    const [first, second] = appStoreReviews(appStorePage);
    expect(first).toMatchObject({
      store: "app_store",
      id: "00000191-be75-7003-3836-082100000000",
      stars: 5,
      title: "Thank you",
      text: "Amazing",
      author: "God is Loveee",
      country: "Spain",
      date: "2026-03-08T20:22:08.000Z",
      reply: { id: "resp-1", text: "Thanks!", pending: true, date: "2026-03-09T17:00:00.000Z" },
    });
    expect(second.country).toBe("Mexico");
    expect(second.reply).toBeNull();
  });

  test("adds up the storefronts' ratings", () => {
    const sum = sumAppStoreRatings([
      { country: "es", average: 5, count: 8 },
      { country: "us", average: 2, count: 2 },
      { country: "mx", average: 0, count: 0 },
    ]);
    expect(sum.count).toBe(10);
    expect(sum.average).toBeCloseTo(4.4);
    expect(sum.countries.map((c) => c.country)).toEqual(["Spain", "United States"]);
    expect(sumAppStoreRatings([]).average).toBeNull();
  });
});

// reviews/reviews_com.biblegamesproject.didacticjesusgame_202511.csv (decoded from
// UTF-16), trimmed. The last row is the first one again in a later month's file.
const playCsv = `Package Name,App Version Code,App Version Name,Reviewer Language,Device,Review Submit Date and Time,Review Submit Millis Since Epoch,Review Last Update Date and Time,Review Last Update Millis Since Epoch,Star Rating,Review Title,Review Text,Developer Reply Date and Time,Developer Reply Millis Since Epoch,Developer Reply Text,Review Link
com.biblegamesproject.didacticjesusgame,,,pt,a06,2025-11-05T14:40:32Z,1762353632542,2025-11-05T14:40:32Z,1762353632542,5,,muito bom,2025-11-13T13:02:47Z,1763038967867,Thanks so much! I’m really glad you’re enjoying it 😄🙏,http://play.google.com/console/developers/5703434093791091508/app/4972291993352168277/user-feedback/review-details?reviewId=d2b07a18-68e9-4b8f-8042-4102a5082454&corpus=PUBLIC_REVIEWS
com.biblegamesproject.didacticjesusgame,9,1.3.1,ja,F51B,2025-08-12T13:44:12Z,1755006252725,2025-11-13T14:53:59Z,1763045639590,3,,"オフラインでも遊べる。
Thank you for your reply.",,,,http://play.google.com/console/developers/5703434093791091508/app/4972291993352168277/user-feedback/review-details?reviewId=7109f10c-d863-4a41-9a0e-e65dfc325ac5&corpus=PUBLIC_REVIEWS
`;

describe("Google Play", () => {
  test("reads the monthly review exports", () => {
    const [pt, ja] = playReportReviews(playCsv);
    expect(pt).toMatchObject({
      store: "google_play",
      id: "d2b07a18-68e9-4b8f-8042-4102a5082454",
      stars: 5,
      text: "muito bom",
      language: "Portuguese",
      device: "a06",
      edited: false,
      date: "2025-11-05T14:40:32.542Z",
      reply: { text: "Thanks so much! I’m really glad you’re enjoying it 😄🙏" },
      url: "https://play.google.com/console/developers/5703434093791091508/app/4972291993352168277/user-feedback/review-details?reviewId=d2b07a18-68e9-4b8f-8042-4102a5082454&corpus=PUBLIC_REVIEWS",
    });
    expect(ja).toMatchObject({
      stars: 3,
      text: "オフラインでも遊べる。\nThank you for your reply.",
      version: "1.3.1",
      edited: true,
      date: "2025-11-13T14:53:59.590Z",
      reply: null,
    });
  });

  test("reads the Play Developer API's reviews", () => {
    const [review] = playApiReviews({
      reviews: [
        {
          reviewId: "d2b07a18-68e9-4b8f-8042-4102a5082454",
          authorName: "Maria",
          comments: [
            {
              userComment: {
                text: "Great\tmuito bom",
                lastModified: { seconds: "1763100000" },
                starRating: 4,
                reviewerLanguage: "pt_BR",
                appVersionName: "1.3.2",
                deviceMetadata: { productName: "Galaxy A06" },
              },
            },
            { developerComment: { text: "Thanks!", lastModified: { seconds: "1763200000" } } },
          ],
        },
      ],
    });
    expect(review).toMatchObject({
      title: "Great",
      text: "muito bom",
      stars: 4,
      author: "Maria",
      language: "Brazilian Portuguese",
      device: "Galaxy A06",
      reply: { text: "Thanks!", date: "2025-11-15T09:46:40.000Z" },
    });
  });

  test("keeps each review once, newest copy first, with the author and link of any copy", () => {
    const exported = playReportReviews(playCsv);
    const recent = playApiReviews({
      reviews: [
        {
          reviewId: "d2b07a18-68e9-4b8f-8042-4102a5082454",
          authorName: "Maria",
          comments: [
            {
              userComment: {
                text: "muito bom!",
                lastModified: { seconds: "1763100000" },
                starRating: 4,
              },
            },
          ],
        },
      ],
    });
    const merged = mergePlayReviews([...exported, ...recent]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: "d2b07a18-68e9-4b8f-8042-4102a5082454",
      text: "muito bom!",
      stars: 4,
      author: "Maria",
      reply: { text: "Thanks so much! I’m really glad you’re enjoying it 😄🙏" },
    });
    expect(merged[0].url).toContain("reviewId=d2b07a18");
    expect(merged[1].id).toBe("7109f10c-d863-4a41-9a0e-e65dfc325ac5");
    expect("changed" in merged[0]).toBe(false);
  });

  test("lists a rating with no text, which can't be answered", () => {
    const header = playCsv.split("\n")[0];
    const [bare] = playReportReviews(
      `${header}\ncom.biblegames.eden,,,en,m53x,2026-09-07T19:43:18Z,1788810198078,2026-09-07T19:43:18Z,1788810198078,5,,,,,,\n`,
    );
    expect(bare).toMatchObject({ stars: 5, text: "", url: null, canReply: false });
    expect(awaitsReply(bare)).toBe(false);
    const [written] = playReportReviews(playCsv);
    expect(written.canReply).toBe(true);
    expect(awaitsReply(written)).toBe(false);
    expect(awaitsReply({ ...written, reply: null })).toBe(true);
  });

  test("reads the rating count off the store page", () => {
    const html = `<script type="application/ld+json" nonce="x">{"@type":"SoftwareApplication","aggregateRating":{"@type":"AggregateRating","ratingValue":"3.5","ratingCount":"171"}}</script>`;
    expect(playPageRatingCount(html)).toBe(171);
    expect(playPageRatingCount("<html></html>")).toBeNull();
  });
});

// store.steampowered.com/appreviews/2138140?json=1&purchase_type=all, 2026-09-30, trimmed.
const steamPage = {
  success: 1,
  query_summary: {
    review_score_desc: "Positive",
    total_positive: 20,
    total_negative: 3,
    total_reviews: 23,
  },
  reviews: [
    {
      recommendationid: "206500651",
      author: {
        steamid: "76561199208995288",
        personaname: "Universe Ranger",
        playtime_forever: 21,
        playtime_at_review: 21,
      },
      language: "spanish",
      review: "Probé el demo y la verdad está bastante interesante.",
      timestamp_created: 1760232165,
      timestamp_updated: 1760232165,
      voted_up: true,
    },
    {
      recommendationid: "192432339",
      author: {
        steamid: "76561198425469981",
        personaname: "SBogomZaRuku",
        playtime_forever: 992,
        playtime_at_review: 9,
      },
      language: "english",
      review: "Too short. ",
      timestamp_created: 1744363068,
      timestamp_updated: 1744400000,
      voted_up: false,
      developer_response: "Thanks for playing!",
      timestamp_dev_responded: 1744500000,
    },
  ],
};

describe("Steam", () => {
  const labels: Record<string, string> = { spanish: "Spanish (Spain)", english: "English" };

  test("maps reviews, playtime and developer responses", () => {
    const [first, second] = steamReviews(steamPage, 2138140, (name) => labels[name]);
    expect(first).toMatchObject({
      store: "steam",
      id: "206500651",
      stars: null,
      recommended: true,
      author: "Universe Ranger",
      language: "Spanish (Spain)",
      hoursPlayed: 0.4,
      edited: false,
      reply: null,
      url: "https://steamcommunity.com/profiles/76561199208995288/recommended/2138140/",
    });
    expect(second).toMatchObject({
      recommended: false,
      text: "Too short.",
      hoursPlayed: 0.2,
      edited: true,
      reply: { text: "Thanks for playing!", date: "2025-04-12T23:20:00.000Z" },
    });
  });

  test("reads the score from the first page only", () => {
    expect(steamVerdict(steamPage)).toEqual({ label: "Positive", positive: 20, negative: 3 });
    expect(steamVerdict({ success: 1, reviews: [] })).toBeUndefined();
  });
});

describe("sentiment", () => {
  test("puts stars and thumbs on one scale", () => {
    expect(sentimentOf({ stars: 5, recommended: null })).toBe("positive");
    expect(sentimentOf({ stars: 3, recommended: null })).toBe("neutral");
    expect(sentimentOf({ stars: 2, recommended: null })).toBe("negative");
    expect(sentimentOf({ stars: null, recommended: true })).toBe("positive");
    expect(sentimentOf({ stars: null, recommended: false })).toBe("negative");
  });

  test("averages only reviews with stars", () => {
    expect(averageStars([{ stars: 5 }, { stars: 2 }, { stars: null }])).toBe(3.5);
    expect(averageStars([{ stars: null }])).toBeNull();
  });
});
