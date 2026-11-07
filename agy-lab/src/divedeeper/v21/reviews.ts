/** Translate the saved review sample; never fetch reviews again or claim the sample is exhaustive. */
export function savedReviews(dive: any) {
  const saved = dive.v21?.assets?.google_reviews;
  const data = saved?.data;
  const reviews = (data?.reviews ?? []).filter((r: any) => typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5).map((r: any) => ({
    stars: r.rating, date: r.date, author: r.author, text: r.text ?? '', original: r.original ?? r.text ?? '',
    reply: r.owner_reply, listing: saved.profile?.name ?? data.name ?? dive.company,
  }));
  return {
    reviews,
    per_listing: data ? [{ name: saved.profile?.name ?? data.name ?? dive.company, listed_rating: data.rating,
      listed_reviews: data.review_count, pulled: reviews.length, replied: reviews.filter((r: any) => r.reply).length }] : [],
  };
}
