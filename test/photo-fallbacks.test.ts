import {test,expect} from 'bun:test';
import {detailToListing} from '../src/sources/facebook.ts';
test('Facebook keeps the listing card photo when the detail gallery has not loaded',()=>{
 const card={sourceId:'123',url:'https://www.facebook.com/marketplace/item/123/',title:'PC',askingPriceCents:50000,location:null,thumb:'https://scontent.example.invalid/card.jpg'};
 const d={url:card.url,title:'PC',bodyLines:['Gaming PC'],photos:[]};
 expect(detailToListing(d,card).photoUrls).toEqual([card.thumb]);
 expect(detailToListing({...d,photos:['https://scontent.example.invalid/detail.jpg']},card).photoUrls).toEqual(['https://scontent.example.invalid/detail.jpg']);
 expect(detailToListing(d).photoUrls).toEqual([]);
 expect(detailToListing({...d,url:'https://www.facebook.com/marketplace/item/456/'},card).photoUrls).toEqual([]);
});
