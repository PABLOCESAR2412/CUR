export function parseUdemyUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !['www.udemy.com', 'udemy.com'].includes(url.hostname)
    || url.port || url.username || url.password) return null;

  const slug = /^\/course\/([a-z0-9][a-z0-9_-]{0,179})\/?$/i.exec(url.pathname)?.[1]?.toLowerCase();
  if (!slug) return null;

  const canonical = new URL(`https://www.udemy.com/course/${slug}/`);
  const coupon = url.searchParams.get('couponCode');
  const hasCoupon = /^[a-z0-9._-]{1,80}$/i.test(coupon ?? '');
  if (hasCoupon) canonical.searchParams.set('couponCode', coupon);
  const label = slug.replace(/[-_]+/g, ' ');
  return {
    slug,
    url: canonical.href,
    title: label[0].toUpperCase() + label.slice(1),
    hasCoupon,
  };
}
