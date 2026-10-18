// Approximate centre points. Air-quality and weather data come from ~11–45 km grids,
// so a few hundred metres of error makes no difference.

export const TOWNSHIPS = [
  { name: 'City of Elmina', area: 'Shah Alam, Selangor', lat: 3.17, lon: 101.47 },
  { name: 'Bandar Bukit Raja', area: 'Klang, Selangor', lat: 3.09, lon: 101.44 },
  { name: 'Bukit Jelutong', area: 'Shah Alam, Selangor', lat: 3.1, lon: 101.53 },
  { name: 'Ara Damansara', area: 'Petaling Jaya, Selangor', lat: 3.12, lon: 101.58 },
  { name: 'Putra Heights', area: 'Subang Jaya, Selangor', lat: 2.99, lon: 101.57 },
  { name: 'Serenia City', area: 'Sepang, Selangor', lat: 2.86, lon: 101.67 },
  { name: 'Taman Melawati', area: 'Kuala Lumpur', lat: 3.21, lon: 101.75 },
  { name: 'Nilai Impian', area: 'Nilai, Negeri Sembilan', lat: 2.82, lon: 101.79 },
  { name: 'Bandar Ainsdale', area: 'Seremban, Negeri Sembilan', lat: 2.68, lon: 101.92 },
];

export const CITIES = [
  { name: 'Kuala Lumpur', area: 'Wilayah Persekutuan', lat: 3.139, lon: 101.687 },
  { name: 'Putrajaya', area: 'Wilayah Persekutuan', lat: 2.926, lon: 101.696 },
  { name: 'Shah Alam', area: 'Selangor', lat: 3.073, lon: 101.518 },
  { name: 'Klang', area: 'Selangor', lat: 3.045, lon: 101.445 },
  { name: 'Seremban', area: 'Negeri Sembilan', lat: 2.726, lon: 101.938 },
  { name: 'Melaka', area: 'Melaka', lat: 2.196, lon: 102.249 },
  { name: 'Johor Bahru', area: 'Johor', lat: 1.492, lon: 103.741 },
  { name: 'Pasir Gudang', area: 'Johor', lat: 1.47, lon: 103.903 },
  { name: 'Kuantan', area: 'Pahang', lat: 3.812, lon: 103.326 },
  { name: 'Ipoh', area: 'Perak', lat: 4.597, lon: 101.09 },
  { name: 'George Town', area: 'Pulau Pinang', lat: 5.414, lon: 100.329 },
  { name: 'Alor Setar', area: 'Kedah', lat: 6.121, lon: 100.367 },
  { name: 'Kota Bharu', area: 'Kelantan', lat: 6.125, lon: 102.238 },
  { name: 'Kuching', area: 'Sarawak', lat: 1.553, lon: 110.359 },
  { name: 'Kota Kinabalu', area: 'Sabah', lat: 5.98, lon: 116.073 },
];

export const DEFAULT_PLACE = TOWNSHIPS[0];
