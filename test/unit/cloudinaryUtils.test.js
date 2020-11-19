const tracks = [
  {
    default: false,
    kind: 'subtitles',
    label: 'German subtitles',
    src: '/Meetup_german.vtt',
    srclang: 'de'
  },
  {
    default: false,
    kind: 'subtitles',
    label: 'Hebrew subtitles',
    src: '/Meetup_hebrew.vtt',
    srclang: 'he'
  },
  {
    default: false,
    kind: 'subtitles',
    label: 'Swedish subtitles',
    src: '/Meetup_swedish.vtt',
    srclang: 'se'
  }
];
import Utils from '../../src/utils';
import { setupServer } from 'msw/node';
import { rest } from 'msw';

const server = setupServer(
  rest.head('/Meetup_hebrew.vtt', (req, res, ctx) => res(
    ctx.status(404),
    ctx.text('error')
  )),
  rest.head('/Meetup_german.vtt', (req, res, ctx) => res(
    ctx.status(200),
    ctx.text('ok')
  )),
  rest.head('/Meetup_swedish.vtt', (req, res, ctx) => res(
    ctx.status(200),
    ctx.text('ok')
  ))

);
beforeAll(() => server.listen());
afterAll(() => server.close());

describe('video source tests', () => {
  it('test filter out bad vtt', async (done) => {
    let vjs = {
      addRemoteTextTrack: jest.fn()
    };
    const spy = jest.spyOn(vjs, 'addRemoteTextTrack');
    Utils.filterAndAddTextTracks(tracks, vjs);
    setTimeout(() => {
      expect(spy).toHaveBeenCalled();
      done();
    }, 3000);
  });

});
