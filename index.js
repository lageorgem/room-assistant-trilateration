const numeric = require('numeric');
const axios = require('axios');

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
    const optimizedPosition = result.solution;

    // Calculate the error estimate
    // The 'f' property of the result gives the value of the cost function at the solution
    const residualSumOfSquares = result.f;
    const degreesOfFreedom = points.length - 1; // Number of points minus the parameters estimated
    const standardError = Math.sqrt(residualSumOfSquares / degreesOfFreedom);

    return { position: optimizedPosition, error: standardError };
}

// const locationMappings = {
//     kitchen: { x: -0.92, y: 0.99 },
//     living: { x: -4.63, y: -3.475 },
//     bedroom: { x: 2.03, y: 0.58 },
// }

const config = JSON.parse(process.env.HASSIO_ADDON_CONFIG);
const locationMappings = config.location_mappings;
const HA_API_URL = 'http://supervisor/core/api';
const HA_TOKEN = config.ha_long_lived_token;

try {
    const response = await axios.get('http://localhost:6415/entities')
    const data = response.data;
    const devices = data.filter((d) => d.distances);


    const results = await Promise.all(devices.map(async (device) => {
        const points = Object.entries(device.distances)
            .filter(([k, v]) => Object.keys(locationMappings).includes(k))
            .map(([k, v]) => ({
                x: locationMappings[k].x,
                y: locationMappings[k].y,
                radius: v.distance
            }))

        const result = trilateration(points);
        const sensorName = `${device.id}-position`;
        const sensorValue = `(${result.position[0]}, ${result.position[1]})`;

        // Create or update a Home Assistant sensor with the calculated position
        await axios.post(
            `${HA_API_URL}/states/sensor.${sensorName}`,
            {
                state: sensorValue,
                attributes: {
                    x: result.position[0],
                    y: result.position[1],
                    error: result.error
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${HA_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return {name: sensorName, value: sensorValue};
    }));

    console.log('Created sensors:', results);
} catch (e) {
    console.error(`An error has occured while calculating positions: ${e.message} ${e?.response?.data || ''}`)
}

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

//1.95
//3.30