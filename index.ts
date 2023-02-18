// imports
import { randomBytes } from "node:crypto";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import delay from "delay";

// create error
let errNoToken = Error("No valid token");

/**
 * Represents a Twinkly device
 * @public
 *
 */
export class Light {
	ipaddr: string;
	challenge: string;
	net: AxiosInstance;
	token: AuthenticationToken | undefined;
	activeLoginCall: boolean;

	/**
	 * Creates an instance of Light.
	 *
	 * @constructor
	 * @param {string} ipaddr IP Address of the Twinkly device
	 */
	constructor(ipaddr: string, timeout: number = 1000) {
		this.ipaddr = ipaddr;
		this.challenge = randomBytes(256).toString("hex");
		this.net = axios.create({
			baseURL: `http://${this.ipaddr}/xled/v1/`,
			timeout: timeout,
		});
		this.activeLoginCall = false;
	}
	async autoEndLoginCall(): Promise<void> {
		await delay(1000);
		this.activeLoginCall = false;
	}
	/**
	 * Sends a login request
	 *
	 * @returns {*}
	 */
	async login(): Promise<void> {
		this.activeLoginCall = true;
		this.autoEndLoginCall();
		let res: AxiosResponse;
		try {
			res = await this.net.post("/login", {
				challenge: this.challenge,
			});
		} catch (err) {
			throw err;
		}
		this.token = new AuthenticationToken(res);
		this.net.defaults.headers["X-Auth-Token"] = this.token.getToken();
		if (res.data.code != 1000) {
			throw Error("Login request failed");
		}
		console.log("Login request successful");
		try {
			this.verify();
		} catch (err) {
			throw err;
		}
		this.activeLoginCall = false;
	}

	/**
	 * Check that we are logged in to the device
	 */
	async verify(): Promise<void> {
		let res: AxiosResponse;
		if (this.token === undefined) throw errNoToken;
		try {
			res = await this.net.post("/verify", {
				"challenge-response": this.token.getChallengeResponse(),
			});
		} catch (err) {
			throw err;
		}
		if (res.data.code != 1000) {
			throw errNoToken;
		}
	}
	/**
	 * Ensure that we are logged into to the device, and if not initiate a login request
	 */
	async ensureLoggedIn(): Promise<void> {
		try {
			await this.verify();
		} catch (err) {
			if (err != errNoToken) {
				throw err;
			}
			let i = 0;
			while (this.activeLoginCall && i < 5) {
				await delay(1200);
				i++;
			}
			await this.login();
		}
	}

	/**
	 * Gets details about the device
	 *
	 * @returns {Promise<object>} Results vary, see https://xled-docs.readthedocs.io/en/latest/rest_api.html#device-details
	 */
	async getDeviceDetails(): Promise<object> {
		let data = await this.sendGetRequest("/gestalt");
		return data;
	}
	/**
	 * Turns the device off
	 *
	 * @returns {unknown}
	 */
	async setOff(): Promise<void> {
		return this.setMode(deviceMode.off);
	}
	/**
	 * Sets the state
	 * @experimental
	 * @param {boolean} state - Set on/off
	 */
	async setState(state: boolean): Promise<void> {
		return this.setMode(state ? deviceMode.color : deviceMode.off);
	}

	/**
	 * Get the name of the device
	 *
	 * @returns {Promise<string>} Name of device
	 */
	async getName(): Promise<string> {
		let data = await this.sendGetRequest("/device_name");
		let res: string = data.name;
		return res;
	}

	/**
	 * Sets the name of the device
	 *
	 * @param {string} name Desired device name, max 32 charachters
	 * @returns {Promise<void>}
	 */
	async setName(name: string): Promise<void> {
		if (name.length > 32)
			throw new Error("Name is too long - must be 32 char or less");

		await this.sendPostRequest("/led/out/brightness", {
			name: name,
		});
	}

	/**
	 * Gets time when lights will turn on and off
	 *
	 * @returns {Promise<timer>}
	 */
	async getTimer(): Promise<timer> {
		let data: timer = await this.sendGetRequest("/timer");
		return data;
	}
	/**
	 * Sets the brightness level
	 *
	 * @param {number} value
	 * @param {string} [mode="enabled"]
	 * @param {string} [type="A"]
	 * @returns {}
	 */
	async setBrightness(
		value: number,
		mode: string = "enabled",
		type: string = "A"
	): Promise<void> {
		await this.sendPostRequest("/led/out/brightness", {
			mode: mode,
			type: type,
			value: value,
		});
	}

	/**
	 * Gets the current brightness level
	 *
	 * @returns {number} Current brightness in range 0..100
	 */
	async getBrightness(): Promise<number> {
		let data = await this.sendGetRequest("/led/out/brightness", {});
		return data.value;
	}

	/**
	 * Gets the current colour in HSV
	 */
	async getHSVColour(): Promise<hsvColour> {
		let data = await this.sendGetRequest("/led/color", {});
		let res: hsvColour = {
			hue: data.hue,
			saturation: data.saturation,
			value: data.value,
		};
		return res;
	}

	/**
	 * Gets the current colour in RGB
	 */
	async getRGBColour(): Promise<rgbColour> {
		let data = await this.sendGetRequest("/led/color", {});
		let res: rgbColour = { red: data.red, green: data.green, blue: data.blue };
		return res;
	}

	/**
	 * Sets the colour in RGB when in colour mode
	 *
	 * @param {rgbColour} colour A RGB colour
	 */
	async setRGBColour(colour: rgbColour): Promise<void> {
		await this.sendPostRequest("/led/color", {
			red: colour.red,
			green: colour.green,
			blue: colour.blue,
		});
	}

	/**
	 * Sets the colour in HSV when in colour mode
	 *
	 * @param {hsvColour} colour A HSV colour
	 */
	async setHSVColour(colour: hsvColour): Promise<void> {
		await this.sendPostRequest("/led/color", {
			hue: Math.round(colour.hue),
			saturation: Math.round(colour.saturation),
			value: Math.round(colour.value),
		});
	}

	/**
	 * Gets the LED operation mode
	 *
	 * @returns {deviceMode} mode
	 */
	async getMode(): Promise<deviceMode> {
		let res = await this.sendGetRequest("/led/mode", {});
		let mode: deviceMode = (<any>deviceMode)[res.mode];
		return mode;
	}
	/**
	 * Sets the LED operation mode
	 *
	 * @param {deviceMode} mode
	 */
	async setMode(mode: deviceMode): Promise<void> {
		await this.sendPostRequest("/led/mode", { mode: mode });
	}

	/**
	 * Sends a POST request to the device, appending the required tokens
	 *
	 * @param {string} url
	 * @param {object} params
	 */
	async sendPostRequest(url: string, params: object): Promise<any> {
		if (!this.token) throw errNoToken;
		let res: AxiosResponse;
		try {
			res = await this.net.post(url, params);
		} catch (err) {
			throw err;
		}
		if (res.data.code != 1000) {
			throw Error("Mode set failed");
		}
		return res.data;
	}

	/**
	 * Sends a GET request to the device, appending the required tokens
	 *
	 * @param {string} url
	 * @param {object} params
	 */
	async sendGetRequest(url: string, params?: object): Promise<any> {
		if (!this.token) throw errNoToken;
		let res: AxiosResponse;
		try {
			res = await this.net.get(url, params || {});
		} catch (err) {
			throw err;
		}
		if (res.data.code != 1000) {
			throw Error("Get Request failed");
		}
		return res.data;
	}
}
/**
 * Represents an authentication token used to login to an xled instance
 * @internal
 */
export class AuthenticationToken {
	token: string;
	expiry: Date;
	challengeResponse: string;

	/**
	 * Creates an instance of AuthenticationToken.
	 *
	 * @constructor
	 * @param {AxiosResponse} res Response from POST request
	 */
	constructor(res: AxiosResponse) {
		this.token = res.data.authentication_token;
		this.expiry = new Date(
			Date.now() + res.data.authentication_token_expires_in * 1000
		);
		this.challengeResponse = res.data.challenge_response;
	}
	/**
	 *
	 * @returns Token as string
	 */
	getToken(): string {
		return this.token;
	}
	/**
	 *
	 * @returns Challenge response generated by the XLED instance
	 */
	getChallengeResponse(): string {
		return this.challengeResponse;
	}
}
export interface rgbColour {
	/** Red 0..255 */
	red: number;
	/** Green 0..255 */
	green: number;
	/** Blue 0..255 */
	blue: number;
}
export interface hsvColour {
	/** Hue 0..359 */
	hue: number;
	/** Saturation 0..255 */
	saturation: number;
	/** Value (brightness) 0..255 */
	value: number;
}
export enum deviceMode {
	demo = "demo",
	color = "color",
	off = "off",
	effect = "effect",
	movie = "movie",
	playlist = "playlist",
	rt = "rt",
}
export interface timer {
	/** Current time according to the device, seconds after midnight */
	time_now: number;
	/** Time to switch lights on, seconds after midnight. -1 if not set. */
	time_on: number;
	/** Time to switch lights off, seconds after midnight. -1 if not set. */
	time_off: number;
}
