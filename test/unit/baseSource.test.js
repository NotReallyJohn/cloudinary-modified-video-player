import BaseSource from '../../src/plugins/cloudinary/models/base-source.js';
import cloudinary from 'cloudinary-core';
import { objectToQuerystring } from 'utils/querystring';
const cld = cloudinary.Cloudinary.new({ cloud_name: 'demo' });

describe('base source tests', () => {
  it('Test transformation input object', () => {
    let sourceDef = {
      cloudinaryConfig: cld,
      transformation: {
        fetch_format: 'auto'
      }
    };
    let source = new BaseSource('sea_turtle', sourceDef).url();
    // eslint-disable-next-line no-unused-expressions
    expect(source).toContain('f_auto');
  });
  it('Test transformation input array', () => {
    let sourceDef = {
      cloudinaryConfig: cld,
      transformation: [{
        fetch_format: 'auto'
      },
      {
        streaming_profile: 'hd'
      }
      ]
    };
    let source = new BaseSource('sea_turtle', sourceDef).url();
    // eslint-disable-next-line no-unused-expressions
    expect(source).toContain('f_auto');
    expect(source).toContain('sp_hd');
  });
  it('Test transformation input cloudinary transformation', () => {
    let tr = cloudinary.Transformation.new({
      fetch_format: 'auto'
    });
    let sourceDef = {
      cloudinaryConfig: cld,
      transformation: tr
    };
    let source = new BaseSource('sea_turtle', sourceDef).url();
    // eslint-disable-next-line no-unused-expressions
    expect(source).toContain('f_auto');
  });
  it('Test transformation input string (named transformation)', () => {
    let sourceDef = {
      cloudinaryConfig: cld,
      transformation: 'test'
    };
    let source = new BaseSource('sea_turtle', sourceDef).url();
    // eslint-disable-next-line no-unused-expressions
    expect(source).toContain('t_test');
  });
  it('Test query params', () => {
    let sourceDef = {
      cloudinaryConfig: cld,
      queryParams: { test: 'good' }
    };
    let source = new BaseSource('sea_turtle', sourceDef).url();
    // eslint-disable-next-line no-unused-expressions
    expect(source).toContain('test=good');
  });
});
