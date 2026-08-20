/**
 * The shipped stories. Importing this module registers every content
 * module into the story registry (src/story); the server imports it once
 * so `start` can play them and their resources are served.
 */

export { datacenterStory } from "./datacenter/story";
export { odysseyStory } from "./odyssey/story";
