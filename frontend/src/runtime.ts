export const STATIC_DEMO = import.meta.env.VITE_DEMO === '1';
// Docker can preview a separate virtual device without changing its hardware controller.
export const DEMO = STATIC_DEMO || new URLSearchParams(location.search).get('device') === 'demo';
export const assetUrl = (path:string) => import.meta.env.BASE_URL + path.replace(/^\//,'');
export const docsUrl = STATIC_DEMO ? assetUrl('api-docs.html') : '/api/docs';
export const schemaUrl = STATIC_DEMO ? assetUrl('openapi.json') : '/api/v1/openapi.json';
