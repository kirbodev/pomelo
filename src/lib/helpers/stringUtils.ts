/**
 * Trims a specific part of text at a given position to a maximum length
 * @param text - The full text string
 * @param startPosition - The starting position (0-based index) of the section to trim
 * @param sectionLength - The length of the section to trim
 * @param maxLength - Maximum length for the trimmed section
 * @param ellipsis - String to append when text is trimmed (default: "...")
 * @returns The text with the specified section trimmed if necessary
 */
export function trimTextSection(
  text: string,
  startPosition: number,
  sectionLength: number,
  maxLength: number,
  ellipsis: string = "..."
): string {
  // Validate inputs
  if (startPosition < 0 || startPosition >= text.length) {
    return text;
  }

  if (sectionLength <= 0) {
    return text;
  }

  // Calculate end position, ensuring it doesn't exceed text length
  const endPosition = Math.min(startPosition + sectionLength, text.length);

  // Extract the parts
  const beforeSection = text.substring(0, startPosition);
  const sectionToTrim = text.substring(startPosition, endPosition);
  const afterSection = text.substring(endPosition);

  // Trim the section if it's longer than maxLength
  let trimmedSection = sectionToTrim;
  if (sectionToTrim.length > maxLength) {
    // Only add ellipsis if it actually saves space
    const availableSpace = maxLength - ellipsis.length;
    if (availableSpace > 0 && availableSpace < sectionToTrim.length) {
      trimmedSection = sectionToTrim.substring(0, availableSpace) + ellipsis;
    } else {
      // If ellipsis doesn't save space, just truncate without ellipsis
      trimmedSection = sectionToTrim.substring(0, maxLength);
    }
  }

  // Reconstruct the text
  return beforeSection + trimmedSection + afterSection;
}
