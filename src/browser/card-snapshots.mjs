/** Preserve cards removed by virtual scrolling, but let a later observation
 * refresh the same card. Empty lazy-image placeholders must not erase a URL. */
export function rememberCards(observed,cards) {
  for(const card of cards) {
    const prior=observed.get(card.href);
    observed.set(card.href,{...card,photo:card.photo||prior?.photo||''});
  }
}
