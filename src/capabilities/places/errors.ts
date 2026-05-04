export class PlacesError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage)
    this.name = 'PlacesError'
  }
}
