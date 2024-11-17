const numeric = require('numeric');
const axios = require('axios');
const fs = require('fs')

const config = JSON.parse(fs.readFileSync('/data/options.json') || '{}');
const locationMappings = config.location_mappings;
const homeDimensions = config?.home_dimensions;
const roomAssistantURL = config?.room_assistant_url;
const updateInterval = (config?.update_interval || 5) * 1000;

const HA_API_URL = 'http://supervisor/core/api';

if (!locationMappings) throw new Error('Missing configuration: location_mappings');
if (!homeDimensions) throw new Error('Missing configuration: home_dimensions');
if (!roomAssistantURL) throw new Error('Missing configuration: room_assistant_url');

console.log(`Started application with config:
location_mappings: ${JSON.stringify(locationMappings, null, 2)}
home_dimensions: ${JSON.stringify(homeDimensions, null, 2)}
room_assistant_url: ${roomAssistantURL}
update_interval: ${updateInterval}`)

// const locationMappings = {
//     kitchen: { x: -0.92, y: 0.99 },
//     living: { x: -4.63, y: -3.475 },
//     bedroom: { x: 2.03, y: 0.58 },
// }

// const homeDimensions = {
//     width: 10.66,
//     height: 7.75
// }

// - name: kitchen
//   x: -0.92
//   y: 0.99
// - name: living
//   x: -4.63
//   y: -3.475
// - name: bedroom
//   x: 2.03
//   y: 0.58

// width: 10.66
// height: 7.75

function trilateration(points) {
    // points: array of objects with x, y, and radius

    function costFunction(guess) {
        // guess: [x, y] - current guess for the unknown point's position
        return points.reduce((sum, point) => {
            const dx = guess[0] - point.x;
            const dy = guess[1] - point.y;
            const predictedDistance = Math.sqrt(dx * dx + dy * dy);
            const residual = predictedDistance - point.radius;
            return sum + residual * residual;
        }, 0);
    }

    // Initial guess - could be improved based on the specific problem
    let initialGuess = [0, 0];

    // Perform the optimization
    const result = numeric.uncmin(costFunction, initialGuess);

    // Extract the optimized position
    let [x, y] = result.solution;

    // Calculate the error estimate
    // The 'f' property of the result gives the value of the cost function at the solution
    const residualSumOfSquares = result.f;
    const degreesOfFreedom = points.length - 1; // Number of points minus the parameters estimated
    const standardError = Math.sqrt(residualSumOfSquares / degreesOfFreedom);

    // Ensure x, y are within bounds
    const halfWidth = homeDimensions.width / 2;
    const halfHeight = homeDimensions.height / 2;

    x = Math.max(-halfWidth, Math.min(halfWidth, x)); // Clamp x within bounds
    y = Math.max(-halfHeight, Math.min(halfHeight, y)); // Clamp y within bounds

    return {position: [x, y], error: standardError};
}

async function updateSensors() {
    try {
        const response = await axios.get(new URL('/entities', roomAssistantURL).toString())
        const data = response.data;
        const devices = data.filter((d) => d.distances && d.state !== 'not_home');


        const results = await Promise.all(devices.map(async (device) => {
            const points = Object.entries(device.distances)
                .filter(([k, _]) => locationMappings.find((m) => m.name === k))
                .map(([k, v]) => {
                    const pivot = locationMappings.find((m) => m.name === k)
                    return {
                        x: pivot.x,
                        y: pivot.y,
                        radius: v.distance
                    }
                })

            const result = trilateration(points);
            const sensorName = `${device.id.replaceAll("-", "_")}_position`;
            const sensorValue = `${result.position[0]},${result.position[1]}`;

            const payload = {
                friendly_name: device.name,
                state: sensorValue,
                attributes: {
                    x: result.position[0],
                    y: result.position[1],
                    error: result.error
                }
            }

            // Create or update a Home Assistant sensor with the calculated position
            await axios.post(
                `${HA_API_URL}/states/sensor.${sensorName}`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.SUPERVISOR_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return {name: sensorName, value: sensorValue};
        }));

        console.log('Updated sensors:', results);
    } catch (e) {
        console.error(`An error has occured while calculating positions: ${e.message} ${e?.response?.data ? JSON.stringify(e?.response?.data) : ''}`)
    }
}

setInterval(updateSensors, updateInterval)

// Example usage
// const points = [
//     { x: -0.92, y: 0.99, radius: 4.9 },
//     { x: -4.63, y: -3.475, radius: 2 },
// ];
//
// const position = trilateration(points);
// console.log(position);

// House characteristics:
// Width: 10.66m
// Height 7.75m
// Point 0: 5.33, 3.87
// Kitchen RPi:  6.25,  2.88
//      Coords: -0.92,  0.99
//  Living RPi:  0.70,  0.40
//      Coords: -4.63, -3.475
// Bedroom RPi:  1.95, 3.30
//      Coords: 2.03,  0.58

1

//1.95
//3.30